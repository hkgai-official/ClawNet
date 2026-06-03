// src/main/features/agents/blob-client.ts
//
// 1:1 port of macOS GatewayBlobUploader.upload + GatewayBlobDownloader.download.
// POST /blobs returns 201 + {blobId}; GET /blobs/:id returns 200 + raw bytes.
// Network/parse errors are swallowed and return null (matches Swift behavior).

import type { BlobEndpoint } from './blob-endpoint';

export class BlobClient {
  constructor(private readonly endpoint: BlobEndpoint) {}

  async upload(data: Buffer): Promise<{ blobId: string } | null> {
    const url = joinURL(this.endpoint.baseURL, 'blobs');
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    if (this.endpoint.token) headers.Authorization = `Bearer ${this.endpoint.token}`;
    try {
      const res = await fetch(url, { method: 'POST', body: data, headers });
      if (res.status !== 201) return null;
      const json = (await res.json().catch(() => null)) as { blobId?: string } | null;
      if (!json || typeof json.blobId !== 'string') return null;
      return { blobId: json.blobId };
    } catch {
      return null;
    }
  }

  async download(blobId: string): Promise<Buffer | null> {
    const url = joinURL(this.endpoint.baseURL, 'blobs', blobId);
    const headers: Record<string, string> = {};
    if (this.endpoint.token) headers.Authorization = `Bearer ${this.endpoint.token}`;
    try {
      const res = await fetch(url, { method: 'GET', headers });
      if (res.status !== 200) return null;
      const buf = await res.arrayBuffer();
      return Buffer.from(buf);
    } catch {
      return null;
    }
  }
}

function joinURL(base: string, ...segments: string[]): string {
  // Mirrors Swift URL.appendingPathComponent: appends "/seg" preserving the
  // existing query string. baseURL may already have a path or query.
  const u = new URL(base);
  const cleanedPath = u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname;
  u.pathname = [cleanedPath, ...segments].join('/');
  return u.toString();
}
