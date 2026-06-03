import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeReverseAction } from '../undo-executor';
import { snapshotsDir, trashDir } from '../../../utils/workspace-data';
import { serializeTrashMeta } from '../../../../shared/domain/trash';

function deps() { return {}; }

describe('executeReverseAction', () => {
  let ws: string;
  beforeEach(async () => { ws = await mkdtemp(join(tmpdir(), 'undo-')); });
  afterEach(async () => { await rm(ws, { recursive: true, force: true }); });

  it('file.move undo moves file back', async () => {
    const a = join(ws, 'a'); const b = join(ws, 'b');
    await writeFile(b, 'x');
    await executeReverseAction(
      { command: 'file.move', params: { source: b, destination: a } },
      ws, deps(),
    );
    expect(await readFile(a, 'utf-8')).toBe('x');
    await expect(stat(b)).rejects.toBeDefined();
  });

  it('file.move throws CONFLICT when source missing', async () => {
    await expect(executeReverseAction(
      { command: 'file.move', params: { source: '/absent/x', destination: '/y' } },
      ws, deps(),
    )).rejects.toThrow(/CONFLICT/);
  });

  it('file.rename undo renames back', async () => {
    const f = join(ws, 'renamed.txt');
    await writeFile(f, 'x');
    await executeReverseAction(
      { command: 'file.rename', params: { path: f, newName: 'original.txt' } },
      ws, deps(),
    );
    expect(await readFile(join(ws, 'original.txt'), 'utf-8')).toBe('x');
  });

  it('file.trash undo trashes the named file', async () => {
    const f = join(ws, 'copy.txt');
    await mkdir(join(ws, '.clawnet'), { recursive: true });
    await writeFile(f, 'x');
    await executeReverseAction(
      { command: 'file.trash', params: { path: f } },
      ws, deps(),
    );
    await expect(stat(f)).rejects.toBeDefined();
  });

  it('_internal.rmdir removes empty directory', async () => {
    const d = join(ws, 'empty-dir');
    await mkdir(d);
    await executeReverseAction(
      { command: '_internal.rmdir', params: { path: d } },
      ws, deps(),
    );
    await expect(stat(d)).rejects.toBeDefined();
  });

  it('_internal.rmdir throws when directory is non-empty', async () => {
    const d = join(ws, 'occupied');
    await mkdir(d);
    await writeFile(join(d, 'x'), 'x');
    await expect(executeReverseAction(
      { command: '_internal.rmdir', params: { path: d } },
      ws, deps(),
    )).rejects.toThrow(/not empty/i);
  });

  it('_internal.restore_snapshot restores file from snapshot', async () => {
    const target = join(ws, 'doc.txt');
    await writeFile(target, 'modified');
    await mkdir(join(snapshotsDir(ws), 'op_aa'), { recursive: true });
    await writeFile(join(snapshotsDir(ws), 'op_aa', 'doc.txt'), 'original');
    await executeReverseAction(
      { command: '_internal.restore_snapshot', params: { path: target, opId: 'op_aa' } },
      ws, deps(),
    );
    expect(await readFile(target, 'utf-8')).toBe('original');
  });

  it('_internal.restore_trash moves trashed file back', async () => {
    const originalPath = join(ws, 'doc.txt');
    const trashId = '20260513_120000_aaaa';
    const entryDir = join(trashDir(ws), trashId);
    await mkdir(entryDir, { recursive: true });
    await writeFile(join(entryDir, '_meta.json'), serializeTrashMeta({
      originalPath, trashedAt: Date.now(), sessionId: null,
    }), 'utf-8');
    await writeFile(join(entryDir, 'doc.txt'), 'restored');
    await executeReverseAction(
      { command: '_internal.restore_trash', params: { trashId, originalPath } },
      ws, deps(),
    );
    expect(await readFile(originalPath, 'utf-8')).toBe('restored');
  });

  it('throws on unknown reverse command', async () => {
    await expect(executeReverseAction(
      { command: 'totally.unknown', params: {} },
      ws, deps(),
    )).rejects.toThrow(/unknown reverse command/i);
  });
});
