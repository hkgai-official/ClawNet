import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFileWriteHandler } from '../file-write';

const allowPolicy = { check: () => ({ decision: 'allow' as const, reason: '' }) };
const denyWritePolicy = { check: (req: { op: string }) => req.op === 'write' ? { decision: 'deny' as const, reason: 'write denied' } : { decision: 'allow' as const, reason: '' } };

function mockBlobClient(downloadResult: Buffer | null) {
  return {
    upload: vi.fn(),
    download: vi.fn(async () => downloadResult),
  };
}

const endpoint = { baseURL: 'http://h/1', token: 'tok' };
function ctx(paramsJSON: string, withEndpoint = true) {
  const c: { invokeId: string; paramsJSON: string; blobEndpoint?: { baseURL: string; token?: string } } = { invokeId: 'i', paramsJSON };
  if (withEndpoint) c.blobEndpoint = endpoint;
  return c;
}

describe('file.write handler', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'wr-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('errors on missing path', async () => {
    const blob = mockBlobClient(Buffer.from('x'));
    const h = makeFileWriteHandler({ policy: allowPolicy, blobClient: blob });
    expect(JSON.parse(await h(ctx(JSON.stringify({ blobId: 'b' }))))).toEqual({ error: 'missing path' });
  });

  it('errors on missing blobId', async () => {
    const blob = mockBlobClient(Buffer.from('x'));
    const h = makeFileWriteHandler({ policy: allowPolicy, blobClient: blob });
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: join(tmp, 'a') }))));
    expect(r).toEqual({ error: 'missing blobId: file.write requires blob transfer' });
  });

  it('returns policy denial', async () => {
    const blob = mockBlobClient(Buffer.from('x'));
    const h = makeFileWriteHandler({ policy: denyWritePolicy, blobClient: blob });
    expect(JSON.parse(await h(ctx(JSON.stringify({ path: join(tmp, 'a'), blobId: 'b' }))))).toEqual({ error: 'write denied' });
  });

  it('BLOB_ENDPOINT_UNAVAILABLE when ctx.blobEndpoint missing', async () => {
    const blob = mockBlobClient(Buffer.from('x'));
    const h = makeFileWriteHandler({ policy: allowPolicy, blobClient: blob });
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: join(tmp, 'a'), blobId: 'b' }), false)));
    expect(r).toEqual({ error: 'BLOB_ENDPOINT_UNAVAILABLE: no blob endpoint configured for file.write' });
  });

  it('BLOB_DOWNLOAD_FAILED when blob download returns null', async () => {
    const blob = mockBlobClient(null);
    const h = makeFileWriteHandler({ policy: allowPolicy, blobClient: blob });
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: join(tmp, 'a'), blobId: 'b123' }))));
    expect(r).toEqual({ error: 'BLOB_DOWNLOAD_FAILED: b123' });
  });

  it('writes file atomically', async () => {
    const blob = mockBlobClient(Buffer.from('hello'));
    const h = makeFileWriteHandler({ policy: allowPolicy, blobClient: blob });
    const target = join(tmp, 'a.txt');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target, blobId: 'b' }))));
    expect(r).toEqual({ path: target, bytesWritten: 5 });
    expect(await readFile(target, 'utf-8')).toBe('hello');
  });

  it('createDirs=true creates parent directories', async () => {
    const blob = mockBlobClient(Buffer.from('hi'));
    const h = makeFileWriteHandler({ policy: allowPolicy, blobClient: blob });
    const target = join(tmp, 'a', 'b', 'c.txt');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target, blobId: 'b', createDirs: true }))));
    expect(r.bytesWritten).toBe(2);
    expect(await readFile(target, 'utf-8')).toBe('hi');
  });

  it('overwrites silently (no CONFLICT)', async () => {
    const blob = mockBlobClient(Buffer.from('new'));
    const h = makeFileWriteHandler({ policy: allowPolicy, blobClient: blob });
    const target = join(tmp, 'a.txt');
    await writeFile(target, 'old');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target, blobId: 'b' }))));
    expect(r.bytesWritten).toBe(3);
    expect(await readFile(target, 'utf-8')).toBe('new');
  });

  it('append=true appends to existing file', async () => {
    const blob = mockBlobClient(Buffer.from(' world'));
    const h = makeFileWriteHandler({ policy: allowPolicy, blobClient: blob });
    const target = join(tmp, 'a.txt');
    await writeFile(target, 'hello');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target, blobId: 'b', append: true }))));
    expect(r.bytesWritten).toBe(6);
    expect(await readFile(target, 'utf-8')).toBe('hello world');
  });

  it('append=true on missing file falls back to atomic write', async () => {
    const blob = mockBlobClient(Buffer.from('first'));
    const h = makeFileWriteHandler({ policy: allowPolicy, blobClient: blob });
    const target = join(tmp, 'new.txt');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target, blobId: 'b', append: true }))));
    expect(r.bytesWritten).toBe(5);
    expect(await readFile(target, 'utf-8')).toBe('first');
  });
});
