// src/main/store/__tests__/operation-logger.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperationLogger, generateOperationId } from '../operation-logger';
import { logsDir } from '../../utils/workspace-data';
import type { LogEntry } from '../../../shared/domain/operation';

function baseEntry(over: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 'op_0001',
    timestamp: 1700000000000,
    command: 'file.move',
    params: { source: '/a', destination: '/b' },
    result: 'success',
    reversible: true,
    ...over,
  };
}

describe('generateOperationId', () => {
  it('produces "op_<8 hex chars>"', () => {
    const id = generateOperationId();
    expect(id).toMatch(/^op_[0-9a-f]{8}$/);
  });

  it('returns unique ids on repeated calls', () => {
    const a = generateOperationId();
    const b = generateOperationId();
    expect(a).not.toBe(b);
  });
});

describe('OperationLogger workspace-local log', () => {
  let ws: string;
  beforeEach(async () => { ws = await mkdtemp(join(tmpdir(), 'oplog-')); });
  afterEach(async () => { await rm(ws, { recursive: true, force: true }); });

  it('writes a JSONL entry to <wsRoot>/.clawnet/logs/<UTC-date>.jsonl', async () => {
    const logger = new OperationLogger();
    await logger.log(baseEntry({ timestamp: Date.UTC(2026, 4, 13, 12, 0, 0) }), ws);
    const file = join(logsDir(ws), '2026-05-13.jsonl');
    const content = await readFile(file, 'utf-8');
    expect(content.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(content.trim())).toMatchObject({ id: 'op_0001', command: 'file.move' });
  });

  it('appends multiple entries to the same day file', async () => {
    const logger = new OperationLogger();
    const day = Date.UTC(2026, 4, 13, 12, 0, 0);
    await logger.log(baseEntry({ id: 'op_a', timestamp: day }), ws);
    await logger.log(baseEntry({ id: 'op_b', timestamp: day + 1000 }), ws);
    const content = await readFile(join(logsDir(ws), '2026-05-13.jsonl'), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).id).toBe('op_a');
    expect(JSON.parse(lines[1]!).id).toBe('op_b');
  });

  it('separates entries across UTC days', async () => {
    const logger = new OperationLogger();
    await logger.log(baseEntry({ id: 'op_a', timestamp: Date.UTC(2026, 4, 13, 23, 0, 0) }), ws);
    await logger.log(baseEntry({ id: 'op_b', timestamp: Date.UTC(2026, 4, 14, 1, 0, 0) }), ws);
    expect((await readFile(join(logsDir(ws), '2026-05-13.jsonl'), 'utf-8')).trim().split('\n')).toHaveLength(1);
    expect((await readFile(join(logsDir(ws), '2026-05-14.jsonl'), 'utf-8')).trim().split('\n')).toHaveLength(1);
  });
});

describe('OperationLogger query', () => {
  let ws: string;
  beforeEach(async () => { ws = await mkdtemp(join(tmpdir(), 'oplog-')); });
  afterEach(async () => { await rm(ws, { recursive: true, force: true }); });

  it('returns empty result when logs dir does not exist', async () => {
    const logger = new OperationLogger();
    const r = await logger.query({ limit: 50, offset: 0 }, ws);
    expect(r).toEqual({ entries: [], total: 0, hasMore: false });
  });

  it('returns entries sorted by timestamp desc', async () => {
    const logger = new OperationLogger();
    const day = Date.UTC(2026, 4, 13, 12, 0, 0);
    await logger.log(baseEntry({ id: 'op_a', timestamp: day }), ws);
    await logger.log(baseEntry({ id: 'op_b', timestamp: day + 5000 }), ws);
    await logger.log(baseEntry({ id: 'op_c', timestamp: day + 1000 }), ws);
    const r = await logger.query({ limit: 50, offset: 0 }, ws);
    expect(r.entries.map((e) => e.id)).toEqual(['op_b', 'op_c', 'op_a']);
  });

  it('filters by sessionId', async () => {
    const logger = new OperationLogger();
    const day = Date.UTC(2026, 4, 13, 12, 0, 0);
    await logger.log(baseEntry({ id: 'op_a', timestamp: day, sessionId: 's1' }), ws);
    await logger.log(baseEntry({ id: 'op_b', timestamp: day + 1000, sessionId: 's2' }), ws);
    const r = await logger.query({ sessionId: 's1', limit: 50, offset: 0 }, ws);
    expect(r.entries.map((e) => e.id)).toEqual(['op_a']);
  });

  it('filters by command', async () => {
    const logger = new OperationLogger();
    const day = Date.UTC(2026, 4, 13, 12, 0, 0);
    await logger.log(baseEntry({ id: 'op_a', timestamp: day, command: 'file.move' }), ws);
    await logger.log(baseEntry({ id: 'op_b', timestamp: day + 1000, command: 'file.write' }), ws);
    const r = await logger.query({ command: 'file.write', limit: 50, offset: 0 }, ws);
    expect(r.entries.map((e) => e.id)).toEqual(['op_b']);
  });

  it('respects limit and offset, returns hasMore correctly', async () => {
    const logger = new OperationLogger();
    const day = Date.UTC(2026, 4, 13, 12, 0, 0);
    for (let i = 0; i < 5; i++) {
      await logger.log(baseEntry({ id: `op_${i}`, timestamp: day + i * 1000 }), ws);
    }
    const r1 = await logger.query({ limit: 2, offset: 0 }, ws);
    expect(r1.entries).toHaveLength(2);
    expect(r1.total).toBe(5);
    expect(r1.hasMore).toBe(true);
    const r2 = await logger.query({ limit: 2, offset: 4 }, ws);
    expect(r2.entries).toHaveLength(1);
    expect(r2.hasMore).toBe(false);
  });

  it('filters by since/until window', async () => {
    const logger = new OperationLogger();
    const t0 = Date.UTC(2026, 4, 13, 12, 0, 0);
    await logger.log(baseEntry({ id: 'op_a', timestamp: t0 }), ws);
    await logger.log(baseEntry({ id: 'op_b', timestamp: t0 + 5000 }), ws);
    await logger.log(baseEntry({ id: 'op_c', timestamp: t0 + 10000 }), ws);
    const r = await logger.query({ since: t0 + 1000, until: t0 + 8000, limit: 50, offset: 0 }, ws);
    expect(r.entries.map((e) => e.id)).toEqual(['op_b']);
  });
});

describe('OperationLogger findEntry', () => {
  let ws: string;
  beforeEach(async () => { ws = await mkdtemp(join(tmpdir(), 'oplog-')); });
  afterEach(async () => { await rm(ws, { recursive: true, force: true }); });

  it('returns null when not found', async () => {
    const logger = new OperationLogger();
    expect(await logger.findEntry('op_nope', ws)).toBeNull();
  });

  it('returns the entry when present', async () => {
    const logger = new OperationLogger();
    const day = Date.UTC(2026, 4, 13, 12, 0, 0);
    await logger.log(baseEntry({ id: 'op_target', timestamp: day }), ws);
    const found = await logger.findEntry('op_target', ws);
    expect(found?.id).toBe('op_target');
  });
});

describe('OperationLogger isUndone', () => {
  let ws: string;
  beforeEach(async () => { ws = await mkdtemp(join(tmpdir(), 'oplog-')); });
  afterEach(async () => { await rm(ws, { recursive: true, force: true }); });

  it('returns false when no undo entry exists', async () => {
    const logger = new OperationLogger();
    const day = Date.UTC(2026, 4, 13, 12, 0, 0);
    await logger.log(baseEntry({ id: 'op_target', timestamp: day }), ws);
    expect(await logger.isUndone('op_target', ws)).toBe(false);
  });

  it('returns true when undo entry with matching undoTargetId exists', async () => {
    const logger = new OperationLogger();
    const day = Date.UTC(2026, 4, 13, 12, 0, 0);
    await logger.log(baseEntry({ id: 'op_target', timestamp: day }), ws);
    await logger.log(baseEntry({
      id: 'op_undo',
      timestamp: day + 1000,
      type: 'undo',
      undoTargetId: 'op_target',
      reversible: false,
      result: 'success',
    }), ws);
    expect(await logger.isUndone('op_target', ws)).toBe(true);
  });
});
