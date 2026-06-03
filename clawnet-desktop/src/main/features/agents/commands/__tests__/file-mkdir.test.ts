import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFileMkdirHandler } from '../file-mkdir';

const allowPolicy = { check: () => ({ decision: 'allow' as const, reason: '' }) };
const denyPolicy = { check: () => ({ decision: 'deny' as const, reason: 'denied' }) };
function ctx(p: string) { return { invokeId: 'i', paramsJSON: p }; }

describe('file.mkdir handler', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'mkdir-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('errors on missing path', async () => {
    const h = makeFileMkdirHandler({ policy: allowPolicy });
    expect(JSON.parse(await h(ctx('{}')))).toEqual({ error: 'missing path' });
  });

  it('errors on policy deny', async () => {
    const h = makeFileMkdirHandler({ policy: denyPolicy });
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: join(tmp, 'x') }))));
    expect(r).toEqual({ error: 'denied' });
  });

  it('creates new directory with created=true', async () => {
    const h = makeFileMkdirHandler({ policy: allowPolicy });
    const target = join(tmp, 'newdir');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target }))));
    expect(r).toEqual({ path: target, created: true });
    expect((await stat(target)).isDirectory()).toBe(true);
  });

  it('returns created=false when directory already exists (idempotent)', async () => {
    const h = makeFileMkdirHandler({ policy: allowPolicy });
    const target = join(tmp, 'existing');
    await rm(target, { recursive: true, force: true }).catch(() => undefined);
    await h(ctx(JSON.stringify({ path: target })));
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target }))));
    expect(r).toEqual({ path: target, created: false });
  });

  it('returns CONFLICT when path exists as a file', async () => {
    const h = makeFileMkdirHandler({ policy: allowPolicy });
    const target = join(tmp, 'file.txt');
    await writeFile(target, 'x');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target }))));
    expect(r).toEqual({ error: `CONFLICT: path '${target}' exists and is a file, not a directory` });
  });

  it('creates intermediate dirs when recursive=true (default)', async () => {
    const h = makeFileMkdirHandler({ policy: allowPolicy });
    const target = join(tmp, 'a', 'b', 'c');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target }))));
    expect(r.created).toBe(true);
    expect((await stat(target)).isDirectory()).toBe(true);
  });

  it('fails when recursive=false and parent missing', async () => {
    const h = makeFileMkdirHandler({ policy: allowPolicy });
    const target = join(tmp, 'a', 'b', 'c');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target, recursive: false }))));
    expect(r.error).toBeDefined();
  });
});
