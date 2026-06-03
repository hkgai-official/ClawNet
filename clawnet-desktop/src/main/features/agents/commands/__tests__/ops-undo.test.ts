// src/main/features/agents/commands/__tests__/ops-undo.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeOpsUndoHandler } from '../ops-undo';
import { OperationLogger } from '../../../../store/operation-logger';
import { executeReverseAction } from '../../undo-executor';
import type { LogEntry } from '../../../../../shared/domain/operation';

function ctx(p: string) { return { invokeId: 'i', paramsJSON: p }; }

describe('ops.undo handler', () => {
  let ws: string;
  let logger: OperationLogger;
  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'opsundo-'));
    await mkdir(join(ws, '.clawnet'), { recursive: true });
    logger = new OperationLogger();
  });
  afterEach(async () => { await rm(ws, { recursive: true, force: true }); });

  function deps(sid: string | null = null) {
    return {
      logger,
      undoExecutor: executeReverseAction,
      fileAccess: { getEffectiveSettings: () => ({ allowedPaths: [ws] }) },
      getCurrentSessionId: () => sid,
    };
  }

  it('errors on missing operationId', async () => {
    const h = makeOpsUndoHandler(deps());
    const r = JSON.parse(await h(ctx(JSON.stringify({}))));
    expect(r.error).toBe('missing operationId');
  });

  it('returns NOT_FOUND when entry does not exist', async () => {
    const h = makeOpsUndoHandler(deps());
    const r = JSON.parse(await h(ctx(JSON.stringify({ operationId: 'op_nope', path: ws }))));
    expect(r.error).toMatch(/^NOT_FOUND:/);
  });

  it('returns NOT_FOUND when entry belongs to a different session (silent deny)', async () => {
    const e: LogEntry = {
      id: 'op_other', timestamp: Date.now(), sessionId: 'other-session',
      command: 'file.move', params: {}, result: 'success', reversible: true,
      reverseAction: { command: 'file.move', params: { source: '/x', destination: '/y' } },
    };
    await logger.log(e, ws);
    const h = makeOpsUndoHandler(deps('my-session'));
    const r = JSON.parse(await h(ctx(JSON.stringify({ operationId: 'op_other', path: ws }))));
    expect(r.error).toMatch(/^NOT_FOUND:/);
  });

  it('returns NOT_REVERSIBLE when entry has no reverseAction', async () => {
    const e: LogEntry = {
      id: 'op_irr', timestamp: Date.now(), command: 'file.write', params: {},
      result: 'success', reversible: false,
    };
    await logger.log(e, ws);
    const h = makeOpsUndoHandler(deps());
    const r = JSON.parse(await h(ctx(JSON.stringify({ operationId: 'op_irr', path: ws }))));
    expect(r.error).toMatch(/^NOT_REVERSIBLE:/);
  });

  it('returns ALREADY_UNDONE when there is a matching undo entry', async () => {
    const e: LogEntry = {
      id: 'op_a', timestamp: Date.now(),
      command: 'file.move', params: {}, result: 'success', reversible: true,
      reverseAction: { command: 'file.move', params: { source: '/x', destination: '/y' } },
    };
    await logger.log(e, ws);
    const u: LogEntry = {
      id: 'op_undo', timestamp: Date.now() + 1, command: 'file.move', params: {},
      result: 'success', reversible: false, type: 'undo', undoTargetId: 'op_a',
    };
    await logger.log(u, ws);
    const h = makeOpsUndoHandler(deps());
    const r = JSON.parse(await h(ctx(JSON.stringify({ operationId: 'op_a', path: ws }))));
    expect(r.error).toMatch(/^ALREADY_UNDONE:/);
  });

  it('returns CONFLICT when preconditions are not met', async () => {
    const e: LogEntry = {
      id: 'op_move', timestamp: Date.now(),
      command: 'file.move', params: {}, result: 'success', reversible: true,
      reverseAction: { command: 'file.move', params: { source: join(ws, 'absent'), destination: join(ws, 'b') } },
    };
    await logger.log(e, ws);
    const h = makeOpsUndoHandler(deps());
    const r = JSON.parse(await h(ctx(JSON.stringify({ operationId: 'op_move', path: ws }))));
    expect(r.error).toMatch(/^CONFLICT:/);
  });

  it('successfully undoes and logs an undo entry', async () => {
    const src = join(ws, 'b'); const dst = join(ws, 'a');
    await writeFile(src, 'x');
    const e: LogEntry = {
      id: 'op_ok', timestamp: Date.now(),
      command: 'file.move', params: {}, result: 'success', reversible: true,
      reverseAction: { command: 'file.move', params: { source: src, destination: dst } },
    };
    await logger.log(e, ws);
    const h = makeOpsUndoHandler(deps());
    const r = JSON.parse(await h(ctx(JSON.stringify({ operationId: 'op_ok', path: ws }))));
    expect(r).toMatchObject({ operationId: 'op_ok', undone: true });
    expect(await readFile(dst, 'utf-8')).toBe('x');

    const q = await logger.query({ limit: 50, offset: 0 }, ws);
    const undoEntry = q.entries.find((x) => x.type === 'undo');
    expect(undoEntry?.undoTargetId).toBe('op_ok');
  });

  it('returns UNDO_FAILED when executor throws non-CONFLICT', async () => {
    const e: LogEntry = {
      id: 'op_x', timestamp: Date.now(),
      command: 'file.move', params: {}, result: 'success', reversible: true,
      reverseAction: { command: 'totally.unknown', params: {} },
    };
    await logger.log(e, ws);
    const h = makeOpsUndoHandler({
      ...deps(),
      undoExecutor: async () => { throw new Error('boom'); },
    });
    const r = JSON.parse(await h(ctx(JSON.stringify({ operationId: 'op_x', path: ws }))));
    expect(r.error).toMatch(/^UNDO_FAILED:/);
  });
});
