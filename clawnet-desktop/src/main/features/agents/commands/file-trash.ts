// src/main/features/agents/commands/file-trash.ts
//
// 1:1 port of macOS FileTrashHandler.swift:12-70. Workspace-local trash
// at <wsRoot>/.clawnet/trash/<trashId>/ — does not use OS recycle bin
// so future ops.undo can recover with full path metadata.

import { z } from 'zod';
import { stat, rename, rm, writeFile, readFile as fsReadFile, readdir as fsReaddir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { NodeCommandHandler, NodeCommandContext } from '../node-event-handler';
import {
  findWorkspaceRoot,
  trashDir,
  generateTrashId,
  ensureDirectory,
  type BookmarksLike,
} from '../../../utils/workspace-data';
import { serializeTrashMeta, parseTrashMeta } from '../../../../shared/domain/trash';

export interface CommandPolicyLike {
  check(req: { path: string; op: string; agentId: string }): { decision: string; reason: string };
}

export interface FileAccessLike {
  getEffectiveSettings(): { allowedPaths: string[] } | null;
}

export interface FileTrashHandlerDeps {
  policy: CommandPolicyLike;
  fileAccess: FileAccessLike;
  bookmarks?: BookmarksLike;
}

const ParamsSchema = z.object({
  path: z.string().min(1),
});

function errorJSON(message: string): string { return JSON.stringify({ error: message }); }
function okJSON(d: Record<string, unknown>): string { return JSON.stringify(d); }

export function makeFileTrashHandler(deps: FileTrashHandlerDeps): NodeCommandHandler {
  return async (ctx: NodeCommandContext) => {
    if (!ctx.paramsJSON) return errorJSON('missing path');
    let raw: unknown;
    try { raw = JSON.parse(ctx.paramsJSON); } catch { return errorJSON('invalid params'); }
    const parsed = ParamsSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      if (issues.some((i) => i.path[0] === 'path')) return errorJSON('missing path');
      return errorJSON('invalid params');
    }
    const path = parsed.data.path;

    const readCheck = deps.policy.check({ path, op: 'read', agentId: ctx.invokeId });
    if (readCheck.decision === 'deny') return errorJSON(readCheck.reason);
    const writeCheck = deps.policy.check({ path, op: 'write', agentId: ctx.invokeId });
    if (writeCheck.decision === 'deny') return errorJSON(writeCheck.reason);

    try {
      await stat(path);
    } catch {
      return errorJSON(`NOT_FOUND: ${path}`);
    }

    const wsRoot = await findWorkspaceRoot(path, {
      fileAccess: deps.fileAccess.getEffectiveSettings(),
      ...(deps.bookmarks ? { bookmarks: deps.bookmarks } : {}),
    });
    if (!wsRoot) {
      return errorJSON(`NO_WORKSPACE: cannot determine workspace root for path '${path}'`);
    }

    const trashId = generateTrashId();
    const entryDir = join(trashDir(wsRoot), trashId);
    try {
      await ensureDirectory(entryDir);
      const meta = serializeTrashMeta({
        originalPath: path,
        trashedAt: Date.now(),
        sessionId: null,
      });
      await writeFile(join(entryDir, '_meta.json'), meta, 'utf-8');
      await rename(path, join(entryDir, basename(path)));
    } catch (err) {
      await rm(entryDir, { recursive: true, force: true }).catch(() => undefined);
      const msg = err instanceof Error ? err.message : String(err);
      return errorJSON(`trash failed: ${msg}`);
    }

    return okJSON({ path, trashId });
  };
}

/**
 * Restore a file from <wsRoot>/.clawnet/trash/<trashId>/ back to its
 * original path (read from _meta.json), then remove the trash entry dir.
 * 1:1 of macOS FileTrashHandler.restoreFromTrash referenced at
 * UndoValidator.performUndo line 484.
 */
export async function restoreFromTrash(trashId: string, wsRoot: string): Promise<void> {
  const entryDir = join(trashDir(wsRoot), trashId);
  const metaRaw = await fsReadFile(join(entryDir, '_meta.json'), 'utf-8');
  const meta = parseTrashMeta(metaRaw); // throws on malformed
  const originalPath = meta.originalPath;

  // Check originalPath is not already occupied
  try {
    await stat(originalPath);
    throw new Error(`CONFLICT: original path '${originalPath}' is occupied`);
  } catch (err) {
    if ((err as Error).message?.startsWith('CONFLICT:')) throw err;
    // file does not exist — proceed
  }

  const entries = await fsReaddir(entryDir);
  const files = entries.filter((n) => n !== '_meta.json');
  if (files.length === 0) throw new Error(`trash entry '${trashId}' has no payload`);

  await rename(join(entryDir, files[0]!), originalPath);
  await rm(entryDir, { recursive: true, force: true });
}
