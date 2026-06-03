import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { preWriteBackup, restoreSnapshot } from '../snapshot';
import { snapshotsDir } from '../../../utils/workspace-data';

describe('preWriteBackup', () => {
  let ws: string;
  beforeEach(async () => { ws = await mkdtemp(join(tmpdir(), 'snap-')); });
  afterEach(async () => { await rm(ws, { recursive: true, force: true }); });

  it('copies existing file to <wsRoot>/.clawnet/snapshots/<opId>/<basename>', async () => {
    const target = join(ws, 'doc.txt');
    await writeFile(target, 'original');
    await preWriteBackup(target, 'op_aaaa', ws);
    const snap = join(snapshotsDir(ws), 'op_aaaa', basename(target));
    expect(await readFile(snap, 'utf-8')).toBe('original');
  });

  it('is a no-op when source file does not exist', async () => {
    await preWriteBackup(join(ws, 'absent.txt'), 'op_bbbb', ws);
    await expect(stat(join(snapshotsDir(ws), 'op_bbbb'))).rejects.toBeDefined();
  });

  it('overwrites previous snapshot for same opId (idempotent)', async () => {
    const target = join(ws, 'doc.txt');
    await writeFile(target, 'first');
    await preWriteBackup(target, 'op_cccc', ws);
    await writeFile(target, 'second');
    await preWriteBackup(target, 'op_cccc', ws);
    const snap = join(snapshotsDir(ws), 'op_cccc', basename(target));
    expect(await readFile(snap, 'utf-8')).toBe('second');
  });
});

describe('restoreSnapshot', () => {
  let ws: string;
  beforeEach(async () => { ws = await mkdtemp(join(tmpdir(), 'snap-')); });
  afterEach(async () => { await rm(ws, { recursive: true, force: true }); });

  it('restores file content from snapshot and removes the snapshot dir', async () => {
    const target = join(ws, 'doc.txt');
    await writeFile(target, 'original');
    await preWriteBackup(target, 'op_aaaa', ws);
    await writeFile(target, 'modified');

    await restoreSnapshot(target, 'op_aaaa', ws);
    expect(await readFile(target, 'utf-8')).toBe('original');
    await expect(stat(join(snapshotsDir(ws), 'op_aaaa'))).rejects.toBeDefined();
  });

  it('throws when snapshot directory does not exist', async () => {
    await expect(restoreSnapshot(join(ws, 'x.txt'), 'op_missing', ws)).rejects.toThrow();
  });

  it('throws when snapshot directory is empty', async () => {
    await mkdir(join(snapshotsDir(ws), 'op_empty'), { recursive: true });
    await expect(restoreSnapshot(join(ws, 'x.txt'), 'op_empty', ws)).rejects.toThrow();
  });
});
