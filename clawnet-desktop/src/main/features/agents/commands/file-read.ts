// src/main/features/agents/commands/file-read.ts
//
// 1:1 port of macOS FileCommandHandler.swift:12-73.
// Reads up to 100 MB from file at offset/limit, detects UTF-8 vs binary,
// uploads bytes via BlobClient, returns blobId reference.

import { z } from 'zod';
import { open, lstat } from 'node:fs/promises';
import type { NodeCommandHandler, NodeCommandContext } from '../node-event-handler';

export interface CommandPolicyLike {
  check(req: { path: string; op: string; agentId: string }): { decision: string; reason: string };
}

export interface BlobClientLike {
  upload(data: Buffer): Promise<{ blobId: string } | null>;
}

export interface FileReadHandlerDeps {
  policy: CommandPolicyLike;
  blobClient: BlobClientLike;
}

const ParamsSchema = z.object({
  path: z.string().min(1),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(0).optional(),
  encoding: z.string().optional(),
});

const BLOB_READ_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

function errorJSON(msg: string): string { return JSON.stringify({ error: msg }); }
function okJSON(d: Record<string, unknown>): string { return JSON.stringify(d); }

function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

export function makeFileReadHandler(deps: FileReadHandlerDeps): NodeCommandHandler {
  return async (ctx: NodeCommandContext) => {
    if (!ctx.paramsJSON) return errorJSON('missing path');
    let raw: unknown;
    try { raw = JSON.parse(ctx.paramsJSON); } catch { return errorJSON('invalid params'); }
    const parsed = ParamsSchema.safeParse(raw);
    if (!parsed.success) {
      if (parsed.error.issues.some((i) => i.path[0] === 'path')) return errorJSON('missing path');
      return errorJSON('invalid params');
    }
    const { path, encoding } = parsed.data;
    const offset = parsed.data.offset ?? 0;

    const readCheck = deps.policy.check({ path, op: 'read', agentId: ctx.invokeId });
    if (readCheck.decision === 'deny') return errorJSON(readCheck.reason);

    let info;
    try { info = await lstat(path); } catch { return errorJSON(`NOT_FOUND: ${path}`); }
    const fileSize = info.size;

    // Clamp limit BEFORE buffer allocation to avoid OOM on huge limit values.
    const limit = Math.min(parsed.data.limit ?? BLOB_READ_MAX_BYTES, BLOB_READ_MAX_BYTES);
    const buf = Buffer.alloc(limit);
    const handle = await open(path, 'r');
    let bytesRead = 0;
    try {
      const res = await handle.read(buf, 0, limit, offset > 0 ? offset : null);
      bytesRead = res.bytesRead;
    } finally {
      await handle.close();
    }
    const data = buf.subarray(0, bytesRead);
    const hasMore = offset + bytesRead < fileSize;

    const isText = encoding !== 'base64' && isValidUtf8(data);

    if (!ctx.blobEndpoint) return errorJSON('BLOB_ENDPOINT_UNAVAILABLE: no blob endpoint configured for file.read');

    const upload = await deps.blobClient.upload(data);
    if (!upload) return errorJSON('BLOB_UPLOAD_FAILED: failed to upload file data to gateway');

    return okJSON({
      transfer: 'blob',
      blobId: upload.blobId,
      encoding: isText ? 'utf8' : 'base64',
      size: fileSize,
      offset,
      bytesRead,
      hasMore,
    });
  };
}
