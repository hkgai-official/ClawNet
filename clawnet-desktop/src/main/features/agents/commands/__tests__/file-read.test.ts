import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFileReadHandler } from '../file-read';

const allowPolicy = { check: () => ({ decision: 'allow' as const, reason: '' }) };
const denyPolicy = { check: () => ({ decision: 'deny' as const, reason: 'denied' }) };

function mockBlobClient(uploadResult: { blobId: string } | null) {
  return {
    upload: vi.fn(async () => uploadResult),
    download: vi.fn(),
  };
}

const endpoint = { baseURL: 'http://h/1', token: 'tok' };
function ctx(paramsJSON: string, withEndpoint = true) {
  const c: { invokeId: string; paramsJSON: string; blobEndpoint?: { baseURL: string; token?: string } } = { invokeId: 'i', paramsJSON };
  if (withEndpoint) c.blobEndpoint = endpoint;
  return c;
}

describe('file.read handler', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'rd-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('errors on missing path', async () => {
    const blob = mockBlobClient({ blobId: 'b' });
    const h = makeFileReadHandler({ policy: allowPolicy, blobClient: blob });
    expect(JSON.parse(await h(ctx('{}')))).toEqual({ error: 'missing path' });
  });

  it('returns policy denial', async () => {
    const blob = mockBlobClient({ blobId: 'b' });
    const h = makeFileReadHandler({ policy: denyPolicy, blobClient: blob });
    expect(JSON.parse(await h(ctx(JSON.stringify({ path: join(tmp, 'a') }))))).toEqual({ error: 'denied' });
  });

  it('NOT_FOUND when file missing', async () => {
    const blob = mockBlobClient({ blobId: 'b' });
    const h = makeFileReadHandler({ policy: allowPolicy, blobClient: blob });
    const target = join(tmp, 'absent');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target }))));
    expect(r).toEqual({ error: `NOT_FOUND: ${target}` });
  });

  it('BLOB_ENDPOINT_UNAVAILABLE when ctx.blobEndpoint missing', async () => {
    const blob = mockBlobClient({ blobId: 'b' });
    const h = makeFileReadHandler({ policy: allowPolicy, blobClient: blob });
    const target = join(tmp, 'a.txt');
    await writeFile(target, 'x');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target }), false)));
    expect(r).toEqual({ error: 'BLOB_ENDPOINT_UNAVAILABLE: no blob endpoint configured for file.read' });
  });

  it('BLOB_UPLOAD_FAILED when blob upload returns null', async () => {
    const blob = mockBlobClient(null);
    const h = makeFileReadHandler({ policy: allowPolicy, blobClient: blob });
    const target = join(tmp, 'a.txt');
    await writeFile(target, 'x');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target }))));
    expect(r).toEqual({ error: 'BLOB_UPLOAD_FAILED: failed to upload file data to gateway' });
  });

  it('reads UTF-8 text and returns encoding=utf8', async () => {
    const blob = mockBlobClient({ blobId: 'bABC' });
    const h = makeFileReadHandler({ policy: allowPolicy, blobClient: blob });
    const target = join(tmp, 'a.txt');
    await writeFile(target, 'hello, 世界');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target }))));
    expect(r).toEqual({
      transfer: 'blob',
      blobId: 'bABC',
      encoding: 'utf8',
      size: Buffer.byteLength('hello, 世界'),
      offset: 0,
      bytesRead: Buffer.byteLength('hello, 世界'),
      hasMore: false,
    });
  });

  it('detects binary as base64', async () => {
    const blob = mockBlobClient({ blobId: 'b1' });
    const h = makeFileReadHandler({ policy: allowPolicy, blobClient: blob });
    const target = join(tmp, 'a.bin');
    await writeFile(target, Buffer.from([0xff, 0xfe, 0x00, 0x80]));
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target }))));
    expect(r.encoding).toBe('base64');
  });

  it('respects encoding=base64 param even on valid UTF-8 content', async () => {
    const blob = mockBlobClient({ blobId: 'b2' });
    const h = makeFileReadHandler({ policy: allowPolicy, blobClient: blob });
    const target = join(tmp, 'a.txt');
    await writeFile(target, 'hello');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target, encoding: 'base64' }))));
    expect(r.encoding).toBe('base64');
  });

  it('respects offset and reports hasMore=true when more remains', async () => {
    const blob = mockBlobClient({ blobId: 'b3' });
    const h = makeFileReadHandler({ policy: allowPolicy, blobClient: blob });
    const target = join(tmp, 'a.txt');
    await writeFile(target, 'abcdefghij'); // 10 bytes
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: target, offset: 5, limit: 3 }))));
    expect(r.offset).toBe(5);
    expect(r.bytesRead).toBe(3);
    expect(r.hasMore).toBe(true);
  });

  it('clamps limit to 100 MB', async () => {
    const captured: Buffer[] = [];
    const blob = { upload: vi.fn(async (data: Buffer) => { captured.push(data); return { blobId: 'b4' }; }), download: vi.fn() };
    const h = makeFileReadHandler({ policy: allowPolicy, blobClient: blob });
    const target = join(tmp, 'small.txt');
    await writeFile(target, 'x');
    await h(ctx(JSON.stringify({ path: target, limit: 999999999999 })));
    expect(captured[0]?.length).toBe(1);
  });
});
