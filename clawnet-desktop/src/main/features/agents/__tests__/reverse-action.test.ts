import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { buildReverseAction } from '../reverse-action';
import { snapshotsDir } from '../../../utils/workspace-data';

describe('buildReverseAction', () => {
  let ws: string;
  beforeEach(async () => { ws = await mkdtemp(join(tmpdir(), 'ra-')); });
  afterEach(async () => { await rm(ws, { recursive: true, force: true }); });

  it('file.move → file.move with src/dst swapped', async () => {
    const ra = await buildReverseAction('file.move', { source: '/a', destination: '/b' }, 'op_x', ws, '{}');
    expect(ra).toEqual({ command: 'file.move', params: { source: '/b', destination: '/a' } });
  });

  it('file.rename → file.rename with new path and original name', async () => {
    const path = '/work/old.txt';
    const ra = await buildReverseAction('file.rename', { path, newName: 'new.txt' }, 'op_x', ws, '{}');
    expect(ra).toEqual({
      command: 'file.rename',
      params: { path: join(dirname(path), 'new.txt'), newName: basename(path) },
    });
  });

  it('file.copy → file.trash on destination', async () => {
    const ra = await buildReverseAction('file.copy', { source: '/a', destination: '/b' }, 'op_x', ws, '{}');
    expect(ra).toEqual({ command: 'file.trash', params: { path: '/b' } });
  });

  it('file.mkdir → _internal.rmdir', async () => {
    const ra = await buildReverseAction('file.mkdir', { path: '/new-dir' }, 'op_x', ws, '{}');
    expect(ra).toEqual({ command: '_internal.rmdir', params: { path: '/new-dir' } });
  });

  it('file.write with snapshot existing → _internal.restore_snapshot', async () => {
    await mkdir(join(snapshotsDir(ws), 'op_w'), { recursive: true });
    const ra = await buildReverseAction('file.write', { path: '/work/doc.txt' }, 'op_w', ws, '{}');
    expect(ra).toEqual({
      command: '_internal.restore_snapshot',
      params: { path: '/work/doc.txt', opId: 'op_w' },
    });
  });

  it('file.write without snapshot (new file) → file.trash', async () => {
    const ra = await buildReverseAction('file.write', { path: '/work/new.txt' }, 'op_w', ws, '{}');
    expect(ra).toEqual({ command: 'file.trash', params: { path: '/work/new.txt' } });
  });

  it('file.write with append=true → null (not reversible)', async () => {
    const ra = await buildReverseAction('file.write', { path: '/work/log.txt', append: true }, 'op_w', ws, '{}');
    expect(ra).toBeNull();
  });

  it('file.trash → _internal.restore_trash with trashId from result', async () => {
    const result = JSON.stringify({ path: '/work/x.txt', trashId: '20260513_120000_abcd' });
    const ra = await buildReverseAction('file.trash', { path: '/work/x.txt' }, 'op_x', ws, result);
    expect(ra).toEqual({
      command: '_internal.restore_trash',
      params: { trashId: '20260513_120000_abcd', originalPath: '/work/x.txt' },
    });
  });

  it('returns null for unknown commands', async () => {
    const ra = await buildReverseAction('unknown.cmd', {}, 'op_x', ws, '{}');
    expect(ra).toBeNull();
  });
});
