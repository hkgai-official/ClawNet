// src/main/features/agents/commands/file-rename.ts
//
// 1:1 port of macOS FileCommandHandler.swift:359-402.

import { z } from 'zod';
import { lstat, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { NodeCommandHandler, NodeCommandContext } from '../node-event-handler';

export interface CommandPolicyLike {
  check(req: { path: string; op: string; agentId: string }): { decision: string; reason: string };
}

export interface FileRenameHandlerDeps {
  policy: CommandPolicyLike;
}

const ParamsSchema = z.object({
  path: z.string().min(1),
  newName: z.string().min(1),
  overwrite: z.boolean().optional(),
});

function errorJSON(msg: string): string { return JSON.stringify({ error: msg }); }
function okJSON(d: Record<string, unknown>): string { return JSON.stringify(d); }

export function makeFileRenameHandler(deps: FileRenameHandlerDeps): NodeCommandHandler {
  return async (ctx: NodeCommandContext) => {
    if (!ctx.paramsJSON) return errorJSON('missing path');
    let raw: unknown;
    try { raw = JSON.parse(ctx.paramsJSON); } catch { return errorJSON('invalid params'); }
    const parsed = ParamsSchema.safeParse(raw);
    if (!parsed.success) {
      if (parsed.error.issues.some((i) => i.path[0] === 'path')) return errorJSON('missing path');
      if (parsed.error.issues.some((i) => i.path[0] === 'newName')) return errorJSON('missing newName');
      return errorJSON('invalid params');
    }
    const { path, newName, overwrite = false } = parsed.data;

    if (newName.includes('/')) return errorJSON("INVALID_NAME: newName must not contain '/'");

    const readCheck = deps.policy.check({ path, op: 'read', agentId: ctx.invokeId });
    if (readCheck.decision === 'deny') return errorJSON(readCheck.reason);
    const writeCheck = deps.policy.check({ path, op: 'write', agentId: ctx.invokeId });
    if (writeCheck.decision === 'deny') return errorJSON(writeCheck.reason);

    try { await lstat(path); } catch { return errorJSON(`NOT_FOUND: ${path}`); }

    const newPath = join(dirname(path), newName);
    let destExists = false;
    try { await lstat(newPath); destExists = true; } catch { /* not exists */ }
    if (destExists) {
      if (!overwrite) return errorJSON(`CONFLICT: '${newName}' already exists in the same directory`);
      await rm(newPath, { recursive: true, force: true });
    }

    try { await rename(path, newPath); } catch (err) { return errorJSON((err as Error).message); }
    return okJSON({ oldPath: path, newPath });
  };
}
