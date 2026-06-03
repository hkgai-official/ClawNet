import { describe, it, expect, beforeAll, afterEach, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileService } from '../file-service';
import { HttpClient } from '../http-client';

const BASE = 'http://example.test:9010';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let svc: FileService;
beforeEach(() => {
  const httpClient = new HttpClient({
    baseURL: BASE,
    getAccessToken: async () => 'tok',
  });
  svc = new FileService({
    http: httpClient,
    baseURL: BASE,
    getAccessToken: async () => 'tok',
  });
});

describe('FileService.checkFile', () => {
  it('returns the X-File-Id header when server replies 200', async () => {
    server.use(
      http.head(
        `${BASE}/api/v1/files/check/abc123`,
        () => new HttpResponse(null, { status: 200, headers: { 'X-File-Id': 'f-existing' } }),
      ),
    );
    expect(await svc.checkFile('abc123')).toBe('f-existing');
  });
  it('returns null when server replies 404', async () => {
    server.use(
      http.head(`${BASE}/api/v1/files/check/abc123`, () => new HttpResponse(null, { status: 404 })),
    );
    expect(await svc.checkFile('abc123')).toBeNull();
  });
  it('sends a Bearer token', async () => {
    let auth: string | null = null;
    server.use(
      http.head(`${BASE}/api/v1/files/check/abc123`, ({ request }) => {
        auth = request.headers.get('authorization');
        return new HttpResponse(null, { status: 404 });
      }),
    );
    await svc.checkFile('abc123');
    expect(auth).toBe('Bearer tok');
  });
});

describe('FileService.uploadChunk', () => {
  it('POSTs multipart/form-data to the chunk endpoint', async () => {
    let capturedCtype: string | null = null;
    let capturedQuery: string | null = null;
    let capturedBody: string | null = null;
    server.use(
      http.post(`${BASE}/api/v1/files/upload/abc123/chunk`, async ({ request }) => {
        capturedCtype = request.headers.get('content-type');
        capturedQuery = new URL(request.url).searchParams.get('chunk_index');
        capturedBody = await request.text();
        return HttpResponse.json({ status: 'ok' });
      }),
    );
    await svc.uploadChunk('abc123', 0, Buffer.from('hello'));
    expect(capturedCtype).toMatch(/multipart\/form-data; boundary=/);
    expect(capturedQuery).toBe('0');
    expect(capturedBody).toContain('hello');
    expect(capturedBody).toContain('name="file"');
  });
  it('throws ApiError on non-2xx', async () => {
    server.use(
      http.post(`${BASE}/api/v1/files/upload/abc123/chunk`, () => new HttpResponse(null, { status: 500 })),
    );
    await expect(svc.uploadChunk('abc123', 0, Buffer.from('x'))).rejects.toThrow();
  });
  it('forwards AbortSignal to fetch; aborts mid-flight reject with AbortError', async () => {
    server.use(
      http.post(`${BASE}/api/v1/files/upload/abc123/chunk`, async () => {
        // Slow handler so the abort lands before resolution.
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({ status: 'ok' });
      }),
    );
    const ctrl = new AbortController();
    const promise = svc.uploadChunk('abc123', 0, Buffer.from('x'), ctrl.signal);
    setTimeout(() => ctrl.abort(), 20);
    await expect(promise).rejects.toThrow();
  });
});

describe('FileService.completeUpload', () => {
  it('POSTs JSON with snake_case keys and parses FileInfo response', async () => {
    server.use(
      http.post(`${BASE}/api/v1/files/upload/abc123/complete`, async ({ request }) => {
        const body = (await request.json()) as {
          hash: string;
          name: string;
          size: number;
          mime_type: string;
          total_chunks: number;
        };
        expect(body.hash).toBe('abc123');
        expect(body.name).toBe('hello.txt');
        expect(body.size).toBe(5);
        expect(body.mime_type).toBe('text/plain');
        expect(body.total_chunks).toBe(1);
        return HttpResponse.json({
          data: { id: 'f1', name: 'hello.txt', size: 5, mime_type: 'text/plain' },
        });
      }),
    );
    const info = await svc.completeUpload('abc123', 'hello.txt', 5, 'text/plain');
    expect(info.id).toBe('f1');
    expect(info.mimeType).toBe('text/plain'); // post snake→camel conversion
  });
});

describe('FileService.getFileInfo', () => {
  it('GETs and parses FileInfo', async () => {
    server.use(
      http.get(`${BASE}/api/v1/files/f1`, () =>
        HttpResponse.json({
          data: {
            id: 'f1',
            name: 'a.png',
            size: 12,
            mime_type: 'image/png',
            url: 'https://x/a.png',
            thumbnail_url: 'https://x/a.thumb',
          },
        }),
      ),
    );
    const info = await svc.getFileInfo('f1');
    expect(info.url).toBe('https://x/a.png');
    expect(info.thumbnailUrl).toBe('https://x/a.thumb');
  });
});

describe('FileService.downloadFile', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'clawnet-dl-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('GETs /api/v1/files/:id/download with Bearer and writes to destination', async () => {
    server.use(
      http.get(`${BASE}/api/v1/files/f1/download`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer tok');
        return new HttpResponse('binary-content', {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      }),
    );
    const dest = join(tmp, 'out.bin');
    await svc.downloadFile('f1', dest);
    expect(readFileSync(dest, 'utf-8')).toBe('binary-content');
  });

  it('throws ApiError on non-2xx response', async () => {
    server.use(
      http.get(`${BASE}/api/v1/files/f1/download`, () => new HttpResponse(null, { status: 404 })),
    );
    const dest = join(tmp, 'out.bin');
    await expect(svc.downloadFile('f1', dest)).rejects.toThrow();
  });
});

describe('FileService.downloadFileStreaming', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'clawnet-dl-streaming-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('streams bytes to destinationPath, fires onProgress, and finishes at total', async () => {
    server.use(
      http.get(`${BASE}/api/v1/files/f1/download`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer tok');
        return new HttpResponse('hello-world', {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '11' },
        });
      }),
    );
    const dest = join(tmp, 'out.bin');
    const progress: Array<[number, number]> = [];
    await svc.downloadFileStreaming('f1', dest, (b, t) => progress.push([b, t]));
    expect(readFileSync(dest, 'utf-8')).toBe('hello-world');
    expect(progress.length).toBeGreaterThan(0);
    const last = progress.at(-1);
    expect(last?.[0]).toBe(11);
    expect(last?.[1]).toBe(11);
  });

  it('throws ApiError on non-2xx response', async () => {
    server.use(
      http.get(`${BASE}/api/v1/files/f1/download`, () => new HttpResponse(null, { status: 500 })),
    );
    const dest = join(tmp, 'out.bin');
    await expect(svc.downloadFileStreaming('f1', dest)).rejects.toThrow(/HTTP 500/);
  });
});

describe('FileService.searchFiles (ClawNetAPI.swift:657-661)', () => {
  it('GETs /api/v1/search/files with q= and parses FileInfo[]', async () => {
    server.use(
      http.get(`${BASE}/api/v1/search/files`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('q')).toBe('report.pdf');
        return HttpResponse.json({ data: [{
          id: 'f1', name: 'report.pdf', size: 1024, mime_type: 'application/pdf',
        }] });
      }),
    );
    const out = await svc.searchFiles('report.pdf');
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe('report.pdf');
    expect(out[0]?.mimeType).toBe('application/pdf');
  });

  it('returns [] for empty query (no server call)', async () => {
    const out = await svc.searchFiles('');
    expect(out).toEqual([]);
    const out2 = await svc.searchFiles('   ');
    expect(out2).toEqual([]);
  });
});
