// src/main/features/agents/__tests__/node-event-handler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PushDispatcher } from '../../../network/gateway/push';
import { NodeEventHandler, type NodeCommandHandler } from '../node-event-handler';
import type { PushDispatcher as PushDispatcherType } from '../../../network/gateway/push';
import { clearWorkspaceRootHints, findWorkspaceRoot } from '../../../utils/workspace-data';
import * as wsData from '../../../utils/workspace-data';
import { mkdtemp, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BlobEndpoint } from '../blob-endpoint';
import { OperationLogger } from '../../../store/operation-logger';
import { mkdtemp as mkdtempNs, mkdir as mkdirNs, writeFile as writeFileNs, readFile as readFileNs, rm as rmNs } from 'node:fs/promises';
import { tmpdir as tmpdirNs } from 'node:os';

function mockDispatcher() {
  const listeners = new Map<string, (p: unknown) => void>();
  return {
    subscribe(topic: string, listener: (p: unknown) => void) { listeners.set(topic, listener); },
    push(topic: string, payload: unknown) { listeners.get(topic)?.(payload); },
  } as unknown as PushDispatcherType & { push: (t: string, p: unknown) => void };
}

function makeChannel() {
  return { sendRequest: vi.fn() };
}

const PAYLOAD = {
  id: 'invoke-1',
  command: 'file.search',
  paramsJSON: '{"path":"/x","keywords":["foo"]}',
  workspaceRoot: '/x',
  tagNodeAcl: { allowedPaths: ['/x'], deniedPaths: [] },
};

describe('NodeEventHandler routing', () => {
  it('parses node.invoke.request, dispatches to the matching command, sends back node.invoke.result', async () => {
    const channel = makeChannel();
    const dispatcher = new PushDispatcher();
    const fileSearch: NodeCommandHandler = vi.fn(async () => '{"basePath":"/x","results":[]}');
    new NodeEventHandler({ dispatcher, channel, commands: { 'file.search': fileSearch } });

    dispatcher.dispatch({ type: 'push', topic: 'node.invoke.request', payload: PAYLOAD });
    await new Promise((r) => setImmediate(r));

    expect(fileSearch).toHaveBeenCalledWith({
      paramsJSON: '{"path":"/x","keywords":["foo"]}',
      workspaceRoot: '/x',
      tagNodeAcl: { allowedPaths: ['/x'], deniedPaths: [] },
      invokeId: 'invoke-1',
    });
    expect(channel.sendRequest).toHaveBeenCalledWith('node.invoke.result', {
      id: 'invoke-1',
      result: '{"basePath":"/x","results":[]}',
    });
  });

  it('sends back unknown_command error for unregistered commands', async () => {
    const channel = makeChannel();
    const dispatcher = new PushDispatcher();
    new NodeEventHandler({ dispatcher, channel, commands: {} });

    dispatcher.dispatch({ type: 'push', topic: 'node.invoke.request', payload: { ...PAYLOAD, command: 'nope.thing' } });
    await new Promise((r) => setImmediate(r));

    expect(channel.sendRequest).toHaveBeenCalledTimes(1);
    const [, args] = channel.sendRequest.mock.calls[0]!;
    const errPayload = JSON.parse((args as { result: string }).result);
    expect(errPayload.error).toMatch(/unknown_command/);
    expect(errPayload.error).toContain('nope.thing');
  });

  it('sends back error envelope when the handler throws', async () => {
    const channel = makeChannel();
    const dispatcher = new PushDispatcher();
    const fileSearch: NodeCommandHandler = vi.fn(async () => { throw new Error('boom'); });
    new NodeEventHandler({ dispatcher, channel, commands: { 'file.search': fileSearch } });

    dispatcher.dispatch({ type: 'push', topic: 'node.invoke.request', payload: PAYLOAD });
    await new Promise((r) => setImmediate(r));

    const [, args] = channel.sendRequest.mock.calls[0]!;
    const errPayload = JSON.parse((args as { result: string }).result);
    expect(errPayload.error).toBe('boom');
  });

  it('silently drops invalid payloads (missing id)', async () => {
    const channel = makeChannel();
    const dispatcher = new PushDispatcher();
    const fileSearch: NodeCommandHandler = vi.fn();
    new NodeEventHandler({ dispatcher, channel, commands: { 'file.search': fileSearch } });

    dispatcher.dispatch({ type: 'push', topic: 'node.invoke.request', payload: { command: 'file.search' } });
    await new Promise((r) => setImmediate(r));

    expect(fileSearch).not.toHaveBeenCalled();
    expect(channel.sendRequest).not.toHaveBeenCalled();
  });

  it('does NOT subscribe to other topics (e.g. agent.command.fileSearch)', () => {
    const channel = makeChannel();
    const dispatcher = new PushDispatcher();
    const fileSearch: NodeCommandHandler = vi.fn();
    new NodeEventHandler({ dispatcher, channel, commands: { 'file.search': fileSearch } });

    // Old P1-era topic — should be ignored.
    dispatcher.dispatch({ type: 'push', topic: 'agent.command.fileSearch', payload: PAYLOAD });
    expect(fileSearch).not.toHaveBeenCalled();
  });
});

describe('NodeEventHandler dispatch-layer tag-ACL gate + workspace hint (P3C-FileTrash)', () => {
  let channel: { sendRequest: ReturnType<typeof vi.fn> };
  let dispatcher: PushDispatcher;
  let policy: { check: ReturnType<typeof vi.fn>; checkWithTagAcl: ReturnType<typeof vi.fn> };
  let fileSearch: ReturnType<typeof vi.fn>;
  let fileTrash: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearWorkspaceRootHints();
    channel = { sendRequest: vi.fn() };
    dispatcher = new PushDispatcher();
    policy = {
      check: vi.fn().mockReturnValue({ decision: 'allow', reason: 'ok' }),
      checkWithTagAcl: vi.fn().mockReturnValue({ decision: 'allow', reason: 'ok' }),
    };
    fileSearch = vi.fn(async () => '{"results":[]}');
    fileTrash = vi.fn(async () => '{"trashId":"x"}');
    new NodeEventHandler({
      dispatcher,
      channel,
      policy,
      commands: { 'file.search': fileSearch, 'file.trash': fileTrash },
    });
  });

  it('denies with errorJSON when tagNodeAcl rejects the path for file.trash', async () => {
    policy.checkWithTagAcl.mockReturnValueOnce({ decision: 'deny', reason: 'tag-acl-not-allowed' });
    dispatcher.dispatch({
      type: 'push',
      topic: 'node.invoke.request',
      payload: {
        id: 'i-1',
        command: 'file.trash',
        paramsJSON: '{"path":"/forbidden/a.txt"}',
        tagNodeAcl: { allowedPaths: ['/allowed'], deniedPaths: [] },
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(fileTrash).not.toHaveBeenCalled();
    expect(channel.sendRequest).toHaveBeenCalledWith('node.invoke.result', {
      id: 'i-1',
      result: expect.stringContaining('Tag ACL denied'),
    });
  });

  it('passes through to handler when tagNodeAcl allows', async () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'node.invoke.request',
      payload: {
        id: 'i-2',
        command: 'file.trash',
        paramsJSON: '{"path":"/allowed/a.txt"}',
        tagNodeAcl: { allowedPaths: ['/allowed'], deniedPaths: [] },
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(fileTrash).toHaveBeenCalledOnce();
  });

  it('skips the gate for non-file.* commands', async () => {
    const opsCmd = vi.fn(async () => '{}');
    new NodeEventHandler({
      dispatcher,
      channel,
      policy,
      commands: { 'ops.log': opsCmd },
    });
    dispatcher.dispatch({
      type: 'push',
      topic: 'node.invoke.request',
      payload: {
        id: 'i-3',
        command: 'ops.log',
        paramsJSON: '{"path":"/forbidden/x"}',
        tagNodeAcl: { allowedPaths: ['/allowed'], deniedPaths: [] },
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(policy.checkWithTagAcl).not.toHaveBeenCalled();
    expect(opsCmd).toHaveBeenCalled();
  });

  it('passes op="write" to checkWithTagAcl for file.trash', async () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'node.invoke.request',
      payload: {
        id: 'i-4',
        command: 'file.trash',
        paramsJSON: '{"path":"/allowed/a.txt"}',
        tagNodeAcl: { allowedPaths: ['/allowed'], deniedPaths: [] },
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(policy.checkWithTagAcl).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'write' }),
      expect.anything(),
    );
  });

  it('passes op="read" to checkWithTagAcl for file.search', async () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'node.invoke.request',
      payload: {
        id: 'i-5',
        command: 'file.search',
        paramsJSON: '{"path":"/allowed/dir","keywords":["x"]}',
        tagNodeAcl: { allowedPaths: ['/allowed'], deniedPaths: [] },
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(policy.checkWithTagAcl).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'read' }),
      expect.anything(),
    );
  });

  it('skips the gate when paramsJSON is malformed or path is missing', async () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'node.invoke.request',
      payload: {
        id: 'i-6',
        command: 'file.search',
        paramsJSON: 'not json',
        tagNodeAcl: { allowedPaths: ['/allowed'], deniedPaths: [] },
      },
    });
    await new Promise((r) => setImmediate(r));
    expect(policy.checkWithTagAcl).not.toHaveBeenCalled();
    expect(fileSearch).toHaveBeenCalled();
  });

  it('registers non-glob tagNodeAcl.allowedPaths as workspace-root hints', async () => {
    dispatcher.dispatch({
      type: 'push',
      topic: 'node.invoke.request',
      payload: {
        id: 'i-7',
        command: 'file.search',
        paramsJSON: '{"path":"/allowed/dir","keywords":["x"]}',
        tagNodeAcl: { allowedPaths: ['/allowed', '/glob/*'], deniedPaths: [] },
      },
    });
    await new Promise((r) => setImmediate(r));
    const ws = await findWorkspaceRoot('/allowed/dir/file.txt', { fileAccess: null });
    expect(ws).toBe('/allowed');
    const ws2 = await findWorkspaceRoot('/glob/anything', { fileAccess: null });
    expect(ws2).toBeNull();
  });
});

describe('NodeEventHandler — dispatch tag-ACL gate (source/destination)', () => {
  it('denies file.move when destination is outside tag-ACL allowedPaths', () => {
    const channel = { sendRequest: vi.fn() };
    const policy = {
      checkWithTagAcl: vi.fn((req: { path: string; op: string }, _acl: unknown) => {
        if (req.path === '/ws/inside.txt') return { decision: 'allow', reason: '' };
        return { decision: 'deny', reason: 'outside allowed paths' };
      }),
    };
    const dispatcher = mockDispatcher();
    new NodeEventHandler({ dispatcher, channel, commands: {}, policy });

    dispatcher.push('node.invoke.request', {
      id: 'r1',
      command: 'file.move',
      paramsJSON: JSON.stringify({ source: '/ws/inside.txt', destination: '/other/outside.txt' }),
      tagNodeAcl: { allowedPaths: ['/ws'], deniedPaths: [], mode: 'restricted' },
    });

    expect(channel.sendRequest).toHaveBeenCalledWith('node.invoke.result', {
      id: 'r1',
      result: JSON.stringify({ error: 'Tag ACL denied (destination): outside allowed paths' }),
    });
  });

  it('denies file.copy when source is outside tag-ACL allowedPaths', () => {
    const channel = { sendRequest: vi.fn() };
    const policy = {
      checkWithTagAcl: vi.fn((req: { path: string }, _acl: unknown) => {
        if (req.path === '/ws/inside.txt') return { decision: 'allow', reason: '' };
        return { decision: 'deny', reason: 'outside allowed paths' };
      }),
    };
    const dispatcher = mockDispatcher();
    new NodeEventHandler({ dispatcher, channel, commands: {}, policy });

    dispatcher.push('node.invoke.request', {
      id: 'r2',
      command: 'file.copy',
      paramsJSON: JSON.stringify({ source: '/outside/x.txt', destination: '/ws/inside.txt' }),
      tagNodeAcl: { allowedPaths: ['/ws'], deniedPaths: [], mode: 'restricted' },
    });

    expect(channel.sendRequest).toHaveBeenCalledWith('node.invoke.result', {
      id: 'r2',
      result: JSON.stringify({ error: 'Tag ACL denied (source): outside allowed paths' }),
    });
  });

  it('treats file.rename as write op for path-level check', () => {
    const channel = { sendRequest: vi.fn() };
    const calls: Array<{ path: string; op: string }> = [];
    const policy = {
      checkWithTagAcl: vi.fn((req: { path: string; op: string }, _acl: unknown) => {
        calls.push({ path: req.path, op: req.op });
        return { decision: 'allow', reason: '' };
      }),
    };
    const dispatcher = mockDispatcher();
    new NodeEventHandler({ dispatcher, channel, commands: { 'file.rename': async () => '{}' }, policy });

    dispatcher.push('node.invoke.request', {
      id: 'r3',
      command: 'file.rename',
      paramsJSON: JSON.stringify({ path: '/ws/a.txt', newName: 'b.txt' }),
      tagNodeAcl: { allowedPaths: ['/ws'], deniedPaths: [], mode: 'restricted' },
    });

    expect(calls).toEqual([{ path: '/ws/a.txt', op: 'write' }]);
  });

  it('runs gate on source then destination in order for file.move', () => {
    const channel = { sendRequest: vi.fn() };
    const calls: Array<{ path: string; op: string }> = [];
    const policy = {
      checkWithTagAcl: vi.fn((req: { path: string; op: string }, _acl: unknown) => {
        calls.push({ path: req.path, op: req.op });
        return { decision: 'allow', reason: '' };
      }),
    };
    const dispatcher = mockDispatcher();
    new NodeEventHandler({ dispatcher, channel, commands: { 'file.move': async () => '{}' }, policy });

    dispatcher.push('node.invoke.request', {
      id: 'r4',
      command: 'file.move',
      paramsJSON: JSON.stringify({ source: '/ws/a.txt', destination: '/ws/b.txt' }),
      tagNodeAcl: { allowedPaths: ['/ws'], deniedPaths: [], mode: 'restricted' },
    });

    expect(calls).toEqual([
      { path: '/ws/a.txt', op: 'read' },
      { path: '/ws/b.txt', op: 'write' },
    ]);
  });
});

describe('NodeEventHandler — workspace auto-init', () => {
  it('creates .clawnet/ for file.* command when workspace root resolvable from path', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'nodeevent-'));
    // simulate existing workspace hint: put .clawnet/ in tmp so wsRoot resolves
    await mkdir(join(tmp, '.clawnet'), { recursive: true });

    const channel = { sendRequest: vi.fn() };
    const dispatcher = mockDispatcher();
    new NodeEventHandler({
      dispatcher,
      channel,
      commands: { 'file.stat': async () => JSON.stringify({ path: 'x' }) },
    });

    const target = join(tmp, 'a.txt');
    dispatcher.push('node.invoke.request', {
      id: 'ws1',
      command: 'file.stat',
      paramsJSON: JSON.stringify({ path: target }),
    });

    // small wait for async handle()
    await new Promise((r) => setTimeout(r, 50));

    const info = await stat(join(tmp, '.clawnet'));
    expect(info.isDirectory()).toBe(true);
  });

  it('does NOT init .clawnet/ for non-file.* commands', async () => {
    const ensureSpy = vi.spyOn(wsData, 'ensureDirectory');
    const channel = { sendRequest: vi.fn() };
    const dispatcher = mockDispatcher();
    new NodeEventHandler({
      dispatcher,
      channel,
      commands: { 'ops.log': async () => '{}' },
    });

    dispatcher.push('node.invoke.request', {
      id: 'ws2',
      command: 'ops.log',
      paramsJSON: JSON.stringify({}),
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(ensureSpy).not.toHaveBeenCalled();
    ensureSpy.mockRestore();
  });
});

describe('NodeEventHandler — blobEndpoint injection', () => {
  it('passes current blob endpoint to handler context', async () => {
    const captured: { ep?: BlobEndpoint | null } = {};
    const channel = { sendRequest: vi.fn() };
    const dispatcher = mockDispatcher();
    const endpoint: BlobEndpoint = { baseURL: 'http://h/1', token: 'tok' };
    new NodeEventHandler({
      dispatcher,
      channel,
      commands: {
        'file.read': async (ctx) => {
          captured.ep = ctx.blobEndpoint ?? null;
          return '{}';
        },
      },
      getBlobEndpoint: () => endpoint,
    });

    dispatcher.push('node.invoke.request', {
      id: 'b1',
      command: 'file.read',
      paramsJSON: JSON.stringify({ path: '/x' }),
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(captured.ep).toEqual(endpoint);
  });

  it('resolves blob endpoint lazily per request', async () => {
    const channel = { sendRequest: vi.fn() };
    const dispatcher = mockDispatcher();
    let current: BlobEndpoint = { baseURL: 'http://h/1', token: 't1' };
    const captured: Array<BlobEndpoint | null> = [];
    new NodeEventHandler({
      dispatcher,
      channel,
      commands: {
        'file.read': async (ctx) => {
          captured.push(ctx.blobEndpoint ?? null);
          return '{}';
        },
      },
      getBlobEndpoint: () => current,
    });

    dispatcher.push('node.invoke.request', {
      id: 'b1',
      command: 'file.read',
      paramsJSON: JSON.stringify({ path: '/x' }),
    });
    await new Promise((r) => setTimeout(r, 30));
    current = { baseURL: 'http://h/2', token: 't2' };
    dispatcher.push('node.invoke.request', {
      id: 'b2',
      command: 'file.read',
      paramsJSON: JSON.stringify({ path: '/x' }),
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(captured[0]?.token).toBe('t1');
    expect(captured[1]?.token).toBe('t2');
  });
});

describe('NodeEventHandler — logging middleware', () => {
  beforeEach(() => { clearWorkspaceRootHints(); });

  it('writes a log entry for loggable file.move with operationId injected into response', async () => {
    const ws = await mkdtempNs(join(tmpdirNs(), 'nehlog-'));
    await mkdirNs(join(ws, '.clawnet'), { recursive: true });
    const logger = new OperationLogger();
    const channel = { sendRequest: vi.fn() };
    const dispatcher = mockDispatcher();
    new NodeEventHandler({
      dispatcher,
      channel,
      logger,
      getCurrentSessionId: () => 's1',
      commands: {
        'file.move': async () => JSON.stringify({ source: '/a', destination: '/b' }),
      },
    });

    dispatcher.push('node.invoke.request', {
      id: 'r1',
      command: 'file.move',
      paramsJSON: JSON.stringify({ source: join(ws, 'a'), destination: join(ws, 'b') }),
      workspaceRoot: ws,
    });

    await new Promise((r) => setTimeout(r, 150));

    const call = channel.sendRequest.mock.calls.find((c: unknown[]) =>
      c[0] === 'node.invoke.result' && (c[1] as { id: string }).id === 'r1',
    );
    expect(call).toBeDefined();
    const result = JSON.parse((call![1] as { result: string }).result);
    expect(result.operationId).toMatch(/^op_[0-9a-f]+$/);

    const r = await logger.query({ limit: 50, offset: 0 }, ws);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.command).toBe('file.move');
    expect(r.entries[0]!.sessionId).toBe('s1');
    expect(r.entries[0]!.result).toBe('success');

    await rmNs(ws, { recursive: true, force: true });
  });

  it('does NOT log non-loggable commands (file.stat)', async () => {
    const ws = await mkdtempNs(join(tmpdirNs(), 'nehlog-'));
    await mkdirNs(join(ws, '.clawnet'), { recursive: true });
    const logger = new OperationLogger();
    const channel = { sendRequest: vi.fn() };
    const dispatcher = mockDispatcher();
    new NodeEventHandler({
      dispatcher,
      channel,
      logger,
      getCurrentSessionId: () => 's1',
      commands: { 'file.stat': async () => JSON.stringify({ path: 'x' }) },
    });

    dispatcher.push('node.invoke.request', {
      id: 'r2',
      command: 'file.stat',
      paramsJSON: JSON.stringify({ path: join(ws, 'a') }),
      workspaceRoot: ws,
    });

    await new Promise((r) => setTimeout(r, 150));
    const q = await logger.query({ limit: 50, offset: 0 }, ws);
    expect(q.entries).toHaveLength(0);
    await rmNs(ws, { recursive: true, force: true });
  });

  it('takes a preWriteBackup snapshot before file.write overwrite', async () => {
    const ws = await mkdtempNs(join(tmpdirNs(), 'nehlog-'));
    await mkdirNs(join(ws, '.clawnet'), { recursive: true });
    const target = join(ws, 'doc.txt');
    await writeFileNs(target, 'original');

    const logger = new OperationLogger();
    const channel = { sendRequest: vi.fn() };
    const dispatcher = mockDispatcher();
    new NodeEventHandler({
      dispatcher,
      channel,
      logger,
      getCurrentSessionId: () => 's1',
      commands: {
        'file.write': async () => {
          await writeFileNs(target, 'modified');
          return JSON.stringify({ path: target, bytesWritten: 8 });
        },
      },
    });

    dispatcher.push('node.invoke.request', {
      id: 'r3',
      command: 'file.write',
      paramsJSON: JSON.stringify({ path: target, blobId: 'b' }),
      workspaceRoot: ws,
    });

    await new Promise((r) => setTimeout(r, 200));

    const q = await logger.query({ limit: 50, offset: 0 }, ws);
    expect(q.entries).toHaveLength(1);
    const opId = q.entries[0]!.id;
    const snap = await readFileNs(join(ws, '.clawnet', 'snapshots', opId, 'doc.txt'), 'utf-8');
    expect(snap).toBe('original');

    await rmNs(ws, { recursive: true, force: true });
  });

  it('logs errored commands with result="error" and reversible=false', async () => {
    const ws = await mkdtempNs(join(tmpdirNs(), 'nehlog-'));
    await mkdirNs(join(ws, '.clawnet'), { recursive: true });
    const logger = new OperationLogger();
    const channel = { sendRequest: vi.fn() };
    const dispatcher = mockDispatcher();
    new NodeEventHandler({
      dispatcher,
      channel,
      logger,
      getCurrentSessionId: () => 's1',
      commands: { 'file.move': async () => JSON.stringify({ error: 'oops' }) },
    });

    dispatcher.push('node.invoke.request', {
      id: 'r4',
      command: 'file.move',
      paramsJSON: JSON.stringify({ source: join(ws, 'a'), destination: join(ws, 'b') }),
      workspaceRoot: ws,
    });

    await new Promise((r) => setTimeout(r, 150));
    const q = await logger.query({ limit: 50, offset: 0 }, ws);
    expect(q.entries).toHaveLength(1);
    expect(q.entries[0]!.result).toBe('error');
    expect(q.entries[0]!.reversible).toBe(false);

    await rmNs(ws, { recursive: true, force: true });
  });
});
