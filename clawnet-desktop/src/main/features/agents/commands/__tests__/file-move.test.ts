import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFileMoveHandler } from '../file-move';

const allowPolicy = { check: () => ({ decision: 'allow' as const, reason: '' }) };
function ctx(p: string) { return { invokeId: 'i', paramsJSON: p }; }

describe('file.move handler', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'mv-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('errors on missing source', async () => {
    const h = makeFileMoveHandler({ policy: allowPolicy });
    expect(JSON.parse(await h(ctx(JSON.stringify({ destination: '/x' }))))).toEqual({ error: 'missing source' });
  });

  it('errors on missing destination', async () => {
    const h = makeFileMoveHandler({ policy: allowPolicy });
    expect(JSON.parse(await h(ctx(JSON.stringify({ source: '/x' }))))).toEqual({ error: 'missing destination' });
  });

  it('NOT_FOUND on missing source file', async () => {
    const h = makeFileMoveHandler({ policy: allowPolicy });
    const src = join(tmp, 'absent');
    const r = JSON.parse(await h(ctx(JSON.stringify({ source: src, destination: join(tmp, 'd') }))));
    expect(r).toEqual({ error: `NOT_FOUND: ${src}` });
  });

  it('PARENT_NOT_FOUND when destination parent missing', async () => {
    const h = makeFileMoveHandler({ policy: allowPolicy });
    const src = join(tmp, 'a'); await writeFile(src, 'x');
    const dst = join(tmp, 'no-such-dir', 'd');
    const r = JSON.parse(await h(ctx(JSON.stringify({ source: src, destination: dst }))));
    expect(r.error).toBe(`PARENT_NOT_FOUND: parent directory '${join(tmp, 'no-such-dir')}' does not exist. Use file.mkdir first.`);
  });

  it('CONFLICT when destination exists and overwrite=false', async () => {
    const h = makeFileMoveHandler({ policy: allowPolicy });
    const src = join(tmp, 'a'); await writeFile(src, 'x');
    const dst = join(tmp, 'b'); await writeFile(dst, 'y');
    const r = JSON.parse(await h(ctx(JSON.stringify({ source: src, destination: dst }))));
    expect(r).toEqual({ error: `CONFLICT: destination '${dst}' already exists` });
  });

  it('moves file successfully', async () => {
    const h = makeFileMoveHandler({ policy: allowPolicy });
    const src = join(tmp, 'a'); await writeFile(src, 'x');
    const dst = join(tmp, 'b');
    const r = JSON.parse(await h(ctx(JSON.stringify({ source: src, destination: dst }))));
    expect(r).toEqual({ source: src, destination: dst });
    await expect(stat(src)).rejects.toBeDefined();
    expect((await stat(dst)).isFile()).toBe(true);
  });

  it('moves a directory', async () => {
    const h = makeFileMoveHandler({ policy: allowPolicy });
    const src = join(tmp, 'srcDir'); await mkdir(src);
    await writeFile(join(src, 'x'), 'x');
    const dst = join(tmp, 'dstDir');
    const r = JSON.parse(await h(ctx(JSON.stringify({ source: src, destination: dst }))));
    expect(r).toEqual({ source: src, destination: dst });
    expect((await stat(dst)).isDirectory()).toBe(true);
  });

  it('overwrite=true replaces existing destination', async () => {
    const h = makeFileMoveHandler({ policy: allowPolicy });
    const src = join(tmp, 'a'); await writeFile(src, 'aaa');
    const dst = join(tmp, 'b'); await writeFile(dst, 'b');
    const r = JSON.parse(await h(ctx(JSON.stringify({ source: src, destination: dst, overwrite: true }))));
    expect(r).toEqual({ source: src, destination: dst });
    expect((await stat(dst)).size).toBe(3);
  });
});
