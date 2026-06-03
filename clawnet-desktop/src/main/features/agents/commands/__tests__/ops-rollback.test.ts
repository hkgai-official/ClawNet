// src/main/features/agents/commands/__tests__/ops-rollback.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeOpsRollbackHandler } from '../ops-rollback';
import { OperationLogger } from '../../../../store/operation-logger';
import { executeReverseAction } from '../../undo-executor';
import type { LogEntry } from '../../../../../shared/domain/operation';

function ctx(p: string) { return { invokeId: 'i', paramsJSON: p }; }

describe('ops.rollback handler', () => {
  let ws: string;
  let logger: OperationLogger;
  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'rb-'));
    await mkdir(join(ws, '.clawnet'), { recursive: true });
    logger = new OperationLogger();
  });
  afterEach(async () => { await rm(ws, { recursive: true, force: true }); });

  function deps() {
    return {
      logger,
      undoExecutor: executeReverseAction,
      fileAccess: { getEffectiveSettings: () => ({ allowedPaths: [ws] }) },
      getCurrentSessionId: () => null as string | null,
    };
  }

  it('errors when neither sessionId nor since provided', async () => {
    const h = makeOpsRollbackHandler(deps());
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: ws }))));
    expect(r.error).toMatch(/sessionId or since/);
  });

  it('dryRun=true returns inventory without executing', async () => {
    const e: LogEntry = {
      id: 'op_a', timestamp: Date.now(), sessionId: 's1',
      command: 'file.move', params: {}, result: 'success', reversible: true,
      reverseAction: { command: 'file.move', params: { source: join(ws, 'b'), destination: join(ws, 'a') } },
    };
    await logger.log(e, ws);
    const h = makeOpsRollbackHandler(deps());
    const r = JSON.parse(await h(ctx(JSON.stringify({ sessionId: 's1', path: ws }))));
    expect(r).toMatchObject({ dryRun: true, totalOperations: 1, reversibleCount: 1, irreversibleCount: 0 });
  });

  it('execute mode (dryRun=false) undoes operations in reverse chronological order', async () => {
    // Chain: op_x (t=1) moved a→b; op_y (t=2) moved b→c.
    // Current state has only c. DESC undo: op_y reverses c→b, then op_x
    // reverses b→a. Final: a='X', b/c gone.
    // (ASC would try op_x first: move c→b — wrong source, CONFLICT.)
    const a = join(ws, 'a');
    const b = join(ws, 'b');
    const c = join(ws, 'c');
    await writeFile(c, 'X');
    const opX: LogEntry = {
      id: 'op_x', timestamp: 1, sessionId: 's1',
      command: 'file.move', params: {}, result: 'success', reversible: true,
      reverseAction: { command: 'file.move', params: { source: b, destination: a } },
    };
    const opY: LogEntry = {
      id: 'op_y', timestamp: 2, sessionId: 's1',
      command: 'file.move', params: {}, result: 'success', reversible: true,
      reverseAction: { command: 'file.move', params: { source: c, destination: b } },
    };
    await logger.log(opX, ws);
    await logger.log(opY, ws);
    const h = makeOpsRollbackHandler(deps());
    const r = JSON.parse(await h(ctx(JSON.stringify({ sessionId: 's1', dryRun: false, path: ws }))));
    expect(r).toMatchObject({ dryRun: false, undone: 2, failed: 0 });
    // After DESC undo: op_y reverses c→b, op_x reverses b→a. Final: a='X'.
    expect(await readFile(a, 'utf-8')).toBe('X');
    await expect(stat(b)).rejects.toBeDefined();
    await expect(stat(c)).rejects.toBeDefined();
  });

  it('stops on first failure and reports failedOperations', async () => {
    const opA: LogEntry = {
      id: 'op_a', timestamp: 1, sessionId: 's1',
      command: 'file.move', params: {}, result: 'success', reversible: true,
      reverseAction: { command: 'file.move', params: { source: '/absent', destination: '/x' } },
    };
    await logger.log(opA, ws);
    const h = makeOpsRollbackHandler(deps());
    const r = JSON.parse(await h(ctx(JSON.stringify({ sessionId: 's1', dryRun: false, path: ws }))));
    expect(r.undone).toBe(0);
    expect(r.failed).toBe(1);
    expect(r.failedOperations[0]).toMatchObject({ id: 'op_a' });
  });

  it('writes a rollback entry to the log', async () => {
    const a = join(ws, 'a'); const b = join(ws, 'b');
    await writeFile(b, '1');
    await logger.log({
      id: 'op_a', timestamp: 1, sessionId: 's1',
      command: 'file.move', params: {}, result: 'success', reversible: true,
      reverseAction: { command: 'file.move', params: { source: b, destination: a } },
    }, ws);
    const h = makeOpsRollbackHandler(deps());
    await h(ctx(JSON.stringify({ sessionId: 's1', dryRun: false, path: ws })));

    const q = await logger.query({ limit: 50, offset: 0 }, ws);
    const rb = q.entries.find((e) => e.type === 'rollback');
    expect(rb).toBeDefined();
    expect(rb?.result).toBe('success');
  });

  it('skips already-undone operations', async () => {
    await logger.log({
      id: 'op_a', timestamp: 1, sessionId: 's1',
      command: 'file.move', params: {}, result: 'success', reversible: true,
      reverseAction: { command: 'file.move', params: { source: '/b', destination: '/a' } },
    }, ws);
    await logger.log({
      id: 'op_undo', timestamp: 2, command: 'file.move', params: {},
      result: 'success', reversible: false, type: 'undo', undoTargetId: 'op_a',
    }, ws);
    const h = makeOpsRollbackHandler(deps());
    const r = JSON.parse(await h(ctx(JSON.stringify({ sessionId: 's1', path: ws }))));
    expect(r.totalOperations).toBe(0);
  });
});
