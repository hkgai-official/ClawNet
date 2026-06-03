// src/main/features/agents/commands/__tests__/ops-log.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeOpsLogHandler } from '../ops-log';
import { OperationLogger } from '../../../../store/operation-logger';
import type { LogEntry } from '../../../../../shared/domain/operation';

function ctx(p: string) { return { invokeId: 'i', paramsJSON: p }; }
const dayMs = Date.UTC(2026, 4, 13, 12, 0, 0);
function entry(over: Partial<LogEntry> = {}): LogEntry {
  return { id: 'op_0001', timestamp: dayMs, command: 'file.move', params: {}, result: 'success', reversible: true, ...over };
}

describe('ops.log handler', () => {
  let ws: string;
  let logger: OperationLogger;
  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'opslog-'));
    await mkdir(join(ws, '.clawnet'), { recursive: true });
    logger = new OperationLogger();
  });
  afterEach(async () => { await rm(ws, { recursive: true, force: true }); });

  function deps() {
    return {
      logger,
      fileAccess: { getEffectiveSettings: () => ({ allowedPaths: [ws] }) },
      getCurrentSessionId: () => null as string | null,
    };
  }

  it('returns NO_WORKSPACE when no path/allowedPaths resolves', async () => {
    const h = makeOpsLogHandler({
      logger,
      fileAccess: { getEffectiveSettings: () => null },
      getCurrentSessionId: () => null,
    });
    const r = JSON.parse(await h(ctx(JSON.stringify({}))));
    expect(r.error).toMatch(/^NO_WORKSPACE:/);
  });

  it('returns empty result for new workspace', async () => {
    const h = makeOpsLogHandler(deps());
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: ws }))));
    expect(r).toEqual({ entries: [], total: 0, hasMore: false });
  });

  it('returns entries with default limit=50 ordered desc', async () => {
    await logger.log(entry({ id: 'op_a', timestamp: dayMs }), ws);
    await logger.log(entry({ id: 'op_b', timestamp: dayMs + 1000 }), ws);
    const h = makeOpsLogHandler(deps());
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: ws }))));
    expect(r.entries.map((e: LogEntry) => e.id)).toEqual(['op_b', 'op_a']);
    expect(r.total).toBe(2);
    expect(r.hasMore).toBe(false);
  });

  it('respects sessionId filter (defaults to current session when unspecified)', async () => {
    await logger.log(entry({ id: 'op_a', timestamp: dayMs, sessionId: 's1' }), ws);
    await logger.log(entry({ id: 'op_b', timestamp: dayMs + 1000, sessionId: 's2' }), ws);
    const h = makeOpsLogHandler({
      logger,
      fileAccess: { getEffectiveSettings: () => ({ allowedPaths: [ws] }) },
      getCurrentSessionId: () => 's1',
    });
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: ws }))));
    expect(r.entries.map((e: LogEntry) => e.id)).toEqual(['op_a']);
  });

  it('allows explicit sessionId param to override current', async () => {
    await logger.log(entry({ id: 'op_a', timestamp: dayMs, sessionId: 's1' }), ws);
    await logger.log(entry({ id: 'op_b', timestamp: dayMs + 1000, sessionId: 's2' }), ws);
    const h = makeOpsLogHandler({
      logger,
      fileAccess: { getEffectiveSettings: () => ({ allowedPaths: [ws] }) },
      getCurrentSessionId: () => 's1',
    });
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: ws, sessionId: 's2' }))));
    expect(r.entries.map((e: LogEntry) => e.id)).toEqual(['op_b']);
  });

  it('respects limit + offset', async () => {
    for (let i = 0; i < 5; i++) {
      await logger.log(entry({ id: `op_${i}`, timestamp: dayMs + i * 1000 }), ws);
    }
    const h = makeOpsLogHandler(deps());
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: ws, limit: 2, offset: 0 }))));
    expect(r.entries.length).toBe(2);
    expect(r.hasMore).toBe(true);
  });
});
