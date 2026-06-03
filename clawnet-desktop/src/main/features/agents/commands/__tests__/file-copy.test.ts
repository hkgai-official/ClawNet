import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, stat, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFileCopyHandler } from '../file-copy';

const allowPolicy = { check: () => ({ decision: 'allow' as const, reason: '' }) };
function ctx(p: string) { return { invokeId: 'i', paramsJSON: p }; }

describe('file.copy handler', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'cp-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('errors on missing source/destination', async () => {
    const h = makeFileCopyHandler({ policy: allowPolicy });
    expect(JSON.parse(await h(ctx(JSON.stringify({ destination: '/x' }))))).toEqual({ error: 'missing source' });
    expect(JSON.parse(await h(ctx(JSON.stringify({ source: '/x' }))))).toEqual({ error: 'missing destination' });
  });

  it('NOT_FOUND on missing source', async () => {
    const h = makeFileCopyHandler({ policy: allowPolicy });
    const src = join(tmp, 'absent');
    const r = JSON.parse(await h(ctx(JSON.stringify({ source: src, destination: join(tmp, 'd') }))));
    expect(r).toEqual({ error: `NOT_FOUND: ${src}` });
  });

  it('PARENT_NOT_FOUND when destination parent missing', async () => {
    const h = makeFileCopyHandler({ policy: allowPolicy });
    const src = join(tmp, 'a'); await writeFile(src, 'x');
    const dst = join(tmp, 'no-such-dir', 'd');
    const r = JSON.parse(await h(ctx(JSON.stringify({ source: src, destination: dst }))));
    expect(r.error).toBe(`PARENT_NOT_FOUND: parent directory '${join(tmp, 'no-such-dir')}' does not exist. Use file.mkdir first.`);
  });

  it('CONFLICT when destination exists and overwrite=false', async () => {
    const h = makeFileCopyHandler({ policy: allowPolicy });
    const src = join(tmp, 'a'); await writeFile(src, 'x');
    const dst = join(tmp, 'b'); await writeFile(dst, 'y');
    const r = JSON.parse(await h(ctx(JSON.stringify({ source: src, destination: dst }))));
    expect(r).toEqual({ error: `CONFLICT: destination '${dst}' already exists` });
  });

  it('copies a file successfully (source remains)', async () => {
    const h = makeFileCopyHandler({ policy: allowPolicy });
    const src = join(tmp, 'a'); await writeFile(src, 'x');
    const dst = join(tmp, 'b');
    const r = JSON.parse(await h(ctx(JSON.stringify({ source: src, destination: dst }))));
    expect(r).toEqual({ source: src, destination: dst });
    expect((await stat(src)).isFile()).toBe(true);
    expect((await readFile(dst, 'utf-8'))).toBe('x');
  });

  it('copies a directory recursively', async () => {
    const h = makeFileCopyHandler({ policy: allowPolicy });
    const src = join(tmp, 'srcDir'); await mkdir(src);
    await writeFile(join(src, 'inner'), 'i');
    const dst = join(tmp, 'dstDir');
    const r = JSON.parse(await h(ctx(JSON.stringify({ source: src, destination: dst }))));
    expect(r).toEqual({ source: src, destination: dst });
    expect((await readFile(join(dst, 'inner'), 'utf-8'))).toBe('i');
  });

  it('overwrite=true replaces destination', async () => {
    const h = makeFileCopyHandler({ policy: allowPolicy });
    const src = join(tmp, 'a'); await writeFile(src, 'aaa');
    const dst = join(tmp, 'b'); await writeFile(dst, 'b');
    const r = JSON.parse(await h(ctx(JSON.stringify({ source: src, destination: dst, overwrite: true }))));
    expect(r).toEqual({ source: src, destination: dst });
    expect((await readFile(dst, 'utf-8'))).toBe('aaa');
  });
});
