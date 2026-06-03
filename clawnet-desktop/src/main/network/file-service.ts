import { z } from 'zod';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { ApiError } from '../core/error';
import type { HttpClient } from './http-client';
import { FileInfoSchema, type FileInfo } from '../../shared/domain/file';

export interface FileServiceOptions {
  http: HttpClient;
  baseURL: string;
  getAccessToken: () => Promise<string | null>;
}

const FileResponseSchema = z.object({ data: FileInfoSchema });
const FilesListResponseSchema = z.object({ data: z.array(FileInfoSchema) });

/**
 * REST upload + download pipeline. 1:1 port of macOS `ClawNetAPI.swift`:
 * - `checkFile`         (ClawNetAPI.swift:176-183)
 * - `uploadChunk`       (ClawNetAPI.swift:185-204)
 * - `completeUpload`    (ClawNetAPI.swift:206-217)
 * - `getFileInfo`       (ClawNetAPI.swift:219-223)
 * - `downloadFile`      (ClawNetAPI.swift:234-245)
 *
 * `checkFile` / `uploadChunk` / `downloadFile` use raw `fetch` because they
 * are not JSON-shaped requests (HEAD with header response, multipart, binary
 * download). `completeUpload` / `getFileInfo` go through `HttpClient` so they
 * pick up the standard snake↔camel conversion + 401-refresh-retry logic.
 */
export class FileService {
  constructor(private readonly opts: FileServiceOptions) {}

  /** HEAD /api/v1/files/check/:hash — returns the existing file id or null. */
  async checkFile(hash: string): Promise<string | null> {
    const url = `${this.baseURL()}/api/v1/files/check/${encodeURIComponent(hash)}`;
    const token = await this.opts.getAccessToken();
    if (!token) throw new ApiError('notAuthenticated', 'Not authenticated');
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 200) return res.headers.get('X-File-Id') ?? null;
    if (res.status === 404) return null;
    throw new ApiError(`http_${res.status}`, `checkFile HTTP ${res.status}`);
  }

  /** POST multipart /api/v1/files/upload/:hash/chunk?chunk_index=N.
   *  Accepts an optional `signal` so the caller (`ChatService.sendMediaMessage`)
   *  can abort an in-flight upload from a user-issued cancel IPC. */
  async uploadChunk(
    hash: string,
    chunkIndex: number,
    buffer: Buffer,
    signal?: AbortSignal,
  ): Promise<void> {
    const url =
      `${this.baseURL()}/api/v1/files/upload/${encodeURIComponent(hash)}/chunk` +
      `?chunk_index=${chunkIndex}`;
    const token = await this.opts.getAccessToken();
    if (!token) throw new ApiError('notAuthenticated', 'Not authenticated');
    const boundary = `----clawnet-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="chunk"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
      'utf-8',
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const body = Buffer.concat([head, buffer, tail]);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new ApiError(`http_${res.status}`, `uploadChunk HTTP ${res.status}`);
  }

  /** POST JSON /api/v1/files/upload/:hash/complete. */
  async completeUpload(
    hash: string,
    name: string,
    size: number,
    mimeType: string,
    totalChunks: number = 1,
  ): Promise<FileInfo> {
    const raw = await this.opts.http.postJson<unknown>(
      `/api/v1/files/upload/${encodeURIComponent(hash)}/complete`,
      { hash, name, size, mimeType, totalChunks },
    );
    return FileResponseSchema.parse(raw).data;
  }

  /** GET /api/v1/files/:id. */
  async getFileInfo(id: string): Promise<FileInfo> {
    const raw = await this.opts.http.getJson<unknown>(
      `/api/v1/files/${encodeURIComponent(id)}`,
    );
    return FileResponseSchema.parse(raw).data;
  }

  /**
   * GET /api/v1/files/:id/download — authenticated binary download.
   * Buffers in memory then writes; matches macOS `URLSession.download(for:)`
   * → `moveItem(at:to:)` semantics (Buffer-bounded for single-chunk uploads).
   */
  async downloadFile(id: string, destinationPath: string): Promise<void> {
    const url = `${this.baseURL()}/api/v1/files/${encodeURIComponent(id)}/download`;
    const token = await this.opts.getAccessToken();
    if (!token) throw new ApiError('notAuthenticated', 'Not authenticated');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new ApiError(`http_${res.status}`, `downloadFile HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, buf);
  }

  /**
   * GET /api/v1/files/:id/download — authenticated streaming download.
   * Sibling to `downloadFile`: rather than buffering the full response in
   * memory then writing, this pipes the response body directly to disk via
   * `createWriteStream`, invoking `onProgress(bytesReceived, totalBytes)`
   * per chunk so the renderer's download bubble can show live progress.
   * Used by `chat.fetchFileForOpen` for the auto-cache-then-open UX.
   */
  async downloadFileStreaming(
    id: string,
    destinationPath: string,
    onProgress?: (bytesReceived: number, totalBytes: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = `${this.baseURL()}/api/v1/files/${encodeURIComponent(id)}/download`;
    const token = await this.opts.getAccessToken();
    if (!token) throw new ApiError('notAuthenticated', 'Not authenticated');
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new ApiError(`http_${res.status}`, `downloadFile HTTP ${res.status}`);
    const totalBytes = Number(res.headers.get('content-length') ?? '0');
    await mkdir(dirname(destinationPath), { recursive: true });
    if (!res.body) throw new ApiError('no_body', 'response has no body');

    const reader = res.body.getReader();
    const out = createWriteStream(destinationPath);
    let bytesReceived = 0;
    // Mid-stream abort: when the caller aborts, drop the partial file from
    // disk so cache hit short-circuit doesn't later return a truncated copy.
    const abortListener = () => {
      reader.cancel().catch(() => undefined);
    };
    signal?.addEventListener('abort', abortListener);
    try {
      while (true) {
        if (signal?.aborted) {
          throw new ApiError('aborted', 'downloadFile aborted');
        }
        const { done, value } = await reader.read();
        if (done) break;
        out.write(Buffer.from(value));
        bytesReceived += value.byteLength;
        onProgress?.(bytesReceived, totalBytes || bytesReceived);
      }
    } finally {
      signal?.removeEventListener('abort', abortListener);
      await new Promise<void>((resolve, reject) =>
        out.end((e?: Error | null) => (e ? reject(e) : resolve())),
      );
      // If the caller aborted, remove the partially-written file so a later
      // cache check doesn't see a stale half-download as "already done".
      if (signal?.aborted) {
        await rm(destinationPath, { force: true }).catch(() => undefined);
      }
    }
  }

  /**
   * Global file search. 1:1 port of macOS `ClawNetAPI.searchFiles` from
   * ClawNet/Networking/ClawNetAPI.swift:657-661.
   *
   * Empty / whitespace queries short-circuit to `[]` to avoid a useless
   * server round-trip when the user hasn't actually typed anything yet.
   */
  async searchFiles(query: string): Promise<FileInfo[]> {
    if (query.trim().length === 0) return [];
    const raw = await this.opts.http.getJson<unknown>(
      `/api/v1/search/files?q=${encodeURIComponent(query)}`,
    );
    return FilesListResponseSchema.parse(raw).data;
  }

  /** Allow runtime base-URL swaps (server URL change in Login form). */
  setBaseURL(newBase: string): void {
    this.opts.baseURL = newBase;
  }

  private baseURL(): string {
    return this.opts.baseURL.replace(/\/$/, '');
  }
}
