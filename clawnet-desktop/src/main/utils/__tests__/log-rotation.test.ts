import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneOldLogs } from '../log-rotation';
import { logsDir } from '../workspace-data';

describe('pruneOldLogs', () => {
  let ws: string;
  beforeEach(async () => { ws = await mkdtemp(join(tmpdir(), 'logrot-')); });
  afterEach(async () => { await rm(ws, { recursive: true, force: true }); });

  it('deletes files older than maxAgeDays', async () => {
    const dir = logsDir(ws);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '2024-01-01.jsonl'), 'old');
    await writeFile(join(dir, '2026-05-13.jsonl'), 'recent');
    const now = Date.UTC(2026, 4, 13);
    const removed = await pruneOldLogs(ws, 90, now);
    expect(removed).toBe(1);
    const remaining = await readdir(dir);
    expect(remaining).toEqual(['2026-05-13.jsonl']);
  });

  it('returns 0 when logs dir does not exist', async () => {
    const removed = await pruneOldLogs(ws, 90);
    expect(removed).toBe(0);
  });

  it('keeps files exactly at threshold', async () => {
    const dir = logsDir(ws);
    await mkdir(dir, { recursive: true });
    const now = Date.UTC(2026, 4, 13);
    const cutoff = new Date(now - 90 * 24 * 3600 * 1000);
    const y = cutoff.getUTCFullYear();
    const m = String(cutoff.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cutoff.getUTCDate()).padStart(2, '0');
    await writeFile(join(dir, `${y}-${m}-${d}.jsonl`), 'cutoff');
    const removed = await pruneOldLogs(ws, 90, now);
    expect(removed).toBe(0);
  });

  it('ignores non-jsonl files', async () => {
    const dir = logsDir(ws);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '2024-01-01.jsonl'), 'old');
    await writeFile(join(dir, 'README.md'), 'leave me');
    await writeFile(join(dir, 'malformed.txt'), 'leave me');
    const now = Date.UTC(2026, 4, 13);
    await pruneOldLogs(ws, 90, now);
    const remaining = (await readdir(dir)).sort();
    expect(remaining).toEqual(['README.md', 'malformed.txt']);
  });
});
