import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger } from '../logger';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'clawnet-log-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('createLogger', () => {
  it('writes a JSONL line per log call to logs/app-YYYY-MM-DD.jsonl', async () => {
    const log = createLogger({ logsDir: tmp, subsystem: 'test', category: 'unit' });
    await log.info('hello', { a: 1 });
    const files = readdirSync(tmp).filter((f) => f.startsWith('app-'));
    expect(files).toHaveLength(1);
    const content = readFileSync(join(tmp, files[0]!), 'utf-8').trim();
    const obj = JSON.parse(content);
    expect(obj.level).toBe('info');
    expect(obj.subsystem).toBe('test');
    expect(obj.category).toBe('unit');
    expect(obj.message).toBe('hello');
    expect(obj.fields).toEqual({ a: 1 });
    expect(obj.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('supports debug, info, warn, error levels', async () => {
    const log = createLogger({ logsDir: tmp, subsystem: 'test', category: 'unit' });
    await log.debug('d');
    await log.info('i');
    await log.warn('w');
    await log.error('e');
    const f = readdirSync(tmp).find((x) => x.startsWith('app-'))!;
    const lines = readFileSync(join(tmp, f), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => JSON.parse(l).level)).toEqual(['debug', 'info', 'warn', 'error']);
  });
});
