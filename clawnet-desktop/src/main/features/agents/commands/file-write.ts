// src/main/features/agents/commands/file-write.ts
//
// 1:1 port of macOS FileCommandHandler.swift:77-124.
// Atomic write = writeFile(tmp) + rename(tmp, target). Append uses fs.appendFile.
// Silent overwrite (no CONFLICT gate).

import { z } from 'zod';
import { writeFile, rename, mkdir, appendFile, lstat, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { NodeCommandHandler, NodeCommandContext } from '../node-event-handler';

export interface CommandPolicyLike {
  check(req: { path: string; op: string; agentId: string }): { decision: string; reason: string };
}

export interface BlobClientLike {
  download(blobId: string): Promise<Buffer | null>;
}

export interface FileWriteHandlerDeps {
  policy: CommandPolicyLike;
  blobClient: BlobClientLike;
}

const ParamsSchema = z.object({
  path: z.string().min(1),
  blobId: z.string().min(1).optional(),
  createDirs: z.boolean().optional(),
  append: z.boolean().optional(),
});

function errorJSON(msg: string): string { return JSON.stringify({ error: msg }); }
function okJSON(d: Record<string, unknown>): string { return JSON.stringify(d); }

async function atomicWrite(target: string, data: Buffer): Promise<void> {
  const tmp = `${target}.tmp-${randomBytes(4).toString('hex')}`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export function makeFileWriteHandler(deps: FileWriteHandlerDeps): NodeCommandHandler {
  return async (ctx: NodeCommandContext) => {
    if (!ctx.paramsJSON) return errorJSON('missing path');
    let raw: unknown;
    try { raw = JSON.parse(ctx.paramsJSON); } catch { return errorJSON('invalid params'); }
    const parsed = ParamsSchema.safeParse(raw);
    if (!parsed.success) {
      if (parsed.error.issues.some((i) => i.path[0] === 'path')) return errorJSON('missing path');
      return errorJSON('invalid params');
    }
    const { path, blobId, createDirs = false, append = false } = parsed.data;

    const writeCheck = deps.policy.check({ path, op: 'write', agentId: ctx.invokeId });
    if (writeCheck.decision === 'deny') return errorJSON(writeCheck.reason);

    if (createDirs) {
      await mkdir(dirname(path), { recursive: true });
    }

    if (!blobId) return errorJSON('missing blobId: file.write requires blob transfer');
    if (!ctx.blobEndpoint) return errorJSON('BLOB_ENDPOINT_UNAVAILABLE: no blob endpoint configured for file.write');

    const data = await deps.blobClient.download(blobId);
    if (!data) return errorJSON(`BLOB_DOWNLOAD_FAILED: ${blobId}`);

    let exists = false;
    try { await lstat(path); exists = true; } catch { /* not exists */ }

    try {
      if (append && exists) {
        await appendFile(path, data);
      } else {
        await atomicWrite(path, data);
      }
    } catch (err) {
      return errorJSON((err as Error).message);
    }

    return okJSON({ path, bytesWritten: data.length });
  };
}
