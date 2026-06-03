import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { makeFileRenameHandler } from '../file-rename';

const allowPolicy = { check: () => ({ decision: 'allow' as const, reason: '' }) };
const denyWritePolicy = { check: (req: { op: string }) => req.op === 'write' ? { decision: 'deny' as const, reason: 'write denied' } : { decision: 'allow' as const, reason: '' } };
function ctx(p: string) { return { invokeId: 'i', paramsJSON: p }; }

describe('file.rename handler', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'rename-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('errors on missing path', async () => {
    const h = makeFileRenameHandler({ policy: allowPolicy });
    expect(JSON.parse(await h(ctx(JSON.stringify({ newName: 'x' }))))).toEqual({ error: 'missing path' });
  });

  it('errors on missing newName', async () => {
    const h = makeFileRenameHandler({ policy: allowPolicy });
    expect(JSON.parse(await h(ctx(JSON.stringify({ path: '/x' }))))).toEqual({ error: 'missing newName' });
  });

  it('rejects newName with slash', async () => {
    const h = makeFileRenameHandler({ policy: allowPolicy });
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: '/x', newName: 'a/b' }))));
    expect(r).toEqual({ error: "INVALID_NAME: newName must not contain '/'" });
  });

  it('returns write policy denial', async () => {
    const h = makeFileRenameHandler({ policy: denyWritePolicy });
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: join(tmp, 'a'), newName: 'b' }))));
    expect(r).toEqual({ error: 'write denied' });
  });

  it('NOT_FOUND on missing source', async () => {
    const h = makeFileRenameHandler({ policy: allowPolicy });
    const target = join(tmp, 'absent.txt');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target, newName: 'b.txt' }))));
    expect(r).toEqual({ error: `NOT_FOUND: ${target}` });
  });

  it('renames successfully', async () => {
    const h = makeFileRenameHandler({ policy: allowPolicy });
    const src = join(tmp, 'old.txt');
    await writeFile(src, 'x');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: src, newName: 'new.txt' }))));
    expect(r.oldPath).toBe(src);
    expect(r.newPath).toBe(join(dirname(src), 'new.txt'));
    expect((await stat(r.newPath)).isFile()).toBe(true);
  });

  it('CONFLICT when destination exists and overwrite=false', async () => {
    const h = makeFileRenameHandler({ policy: allowPolicy });
    const src = join(tmp, 'a.txt'); await writeFile(src, 'a');
    const dst = join(tmp, 'b.txt'); await writeFile(dst, 'b');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: src, newName: 'b.txt' }))));
    expect(r).toEqual({ error: "CONFLICT: 'b.txt' already exists in the same directory" });
  });

  it('overwrite=true replaces existing destination', async () => {
    const h = makeFileRenameHandler({ policy: allowPolicy });
    const src = join(tmp, 'a.txt'); await writeFile(src, 'aaa');
    const dst = join(tmp, 'b.txt'); await writeFile(dst, 'bbb');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: src, newName: 'b.txt', overwrite: true }))));
    expect(r.newPath).toBe(dst);
    expect((await stat(dst)).size).toBe(3); // 'aaa'
  });
});
