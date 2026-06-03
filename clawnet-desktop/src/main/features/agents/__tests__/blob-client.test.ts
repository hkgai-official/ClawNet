import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlobClient } from '../blob-client';

describe('BlobClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uploads data via POST /blobs and returns blobId on 201', async () => {
    const captured: { url?: string; init?: RequestInit | undefined } = {};
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return new Response(JSON.stringify({ blobId: 'b123' }), { status: 201 });
    }) as unknown as typeof fetch;

    const client = new BlobClient({ baseURL: 'http://h:1/api/v1/ws', token: 'tok' });
    const result = await client.upload(Buffer.from('hello'));

    expect(result).toEqual({ blobId: 'b123' });
    expect(captured.url).toBe('http://h:1/api/v1/ws/blobs');
    expect(captured.init?.method).toBe('POST');
    const headers = new Headers(captured.init?.headers);
    expect(headers.get('Content-Type')).toBe('application/octet-stream');
    expect(headers.get('Authorization')).toBe('Bearer tok');
  });

  it('returns null on non-201 upload status', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    const client = new BlobClient({ baseURL: 'http://h/1', token: 'tok' });
    expect(await client.upload(Buffer.from('x'))).toBeNull();
  });

  it('returns null when upload response is missing blobId', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 201 })) as unknown as typeof fetch;
    const client = new BlobClient({ baseURL: 'http://h/1', token: 'tok' });
    expect(await client.upload(Buffer.from('x'))).toBeNull();
  });

  it('downloads via GET /blobs/:id and returns buffer on 200', async () => {
    const captured: { url?: string; init?: RequestInit | undefined } = {};
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new BlobClient({ baseURL: 'http://h:1/api/v1/ws', token: 'tok' });
    const buf = await client.download('b123');

    expect(buf).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(captured.url).toBe('http://h:1/api/v1/ws/blobs/b123');
    expect(captured.init?.method).toBe('GET');
    expect(new Headers(captured.init?.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('returns null on non-200 download status', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    const client = new BlobClient({ baseURL: 'http://h/1', token: 'tok' });
    expect(await client.download('nope')).toBeNull();
  });

  it('omits Authorization header when token is undefined', async () => {
    let auth: string | null = '';
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      auth = new Headers(init?.headers).get('Authorization');
      return new Response(JSON.stringify({ blobId: 'b' }), { status: 201 });
    }) as unknown as typeof fetch;

    const client = new BlobClient({ baseURL: 'http://h/1' });
    await client.upload(Buffer.from('x'));
    expect(auth).toBeNull();
  });

  it('returns null when fetch throws (network error)', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('connection refused'); }) as unknown as typeof fetch;
    const client = new BlobClient({ baseURL: 'http://h/1', token: 'tok' });
    expect(await client.upload(Buffer.from('x'))).toBeNull();
    expect(await client.download('id')).toBeNull();
  });
});
