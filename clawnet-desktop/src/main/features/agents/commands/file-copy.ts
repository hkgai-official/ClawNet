// src/main/features/agents/commands/file-copy.ts
//
// 1:1 port of macOS FileCommandHandler.swift:406-452.

import { z } from 'zod';
import { lstat, cp, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { NodeCommandHandler, NodeCommandContext } from '../node-event-handler';

export interface CommandPolicyLike {
  check(req: { path: string; op: string; agentId: string }): { decision: string; reason: string };
}

export interface FileCopyHandlerDeps {
  policy: CommandPolicyLike;
}

const ParamsSchema = z.object({
  source: z.string().min(1),
  destination: z.string().min(1),
  overwrite: z.boolean().optional(),
});

function errorJSON(msg: string): string { return JSON.stringify({ error: msg }); }
function okJSON(d: Record<string, unknown>): string { return JSON.stringify(d); }

export function makeFileCopyHandler(deps: FileCopyHandlerDeps): NodeCommandHandler {
  return async (ctx: NodeCommandContext) => {
    if (!ctx.paramsJSON) return errorJSON('missing source');
    let raw: unknown;
    try { raw = JSON.parse(ctx.paramsJSON); } catch { return errorJSON('invalid params'); }
    const parsed = ParamsSchema.safeParse(raw);
    if (!parsed.success) {
      if (parsed.error.issues.some((i) => i.path[0] === 'source')) return errorJSON('missing source');
      if (parsed.error.issues.some((i) => i.path[0] === 'destination')) return errorJSON('missing destination');
      return errorJSON('invalid params');
    }
    const { source, destination, overwrite = false } = parsed.data;

    const readCheck = deps.policy.check({ path: source, op: 'read', agentId: ctx.invokeId });
    if (readCheck.decision === 'deny') return errorJSON(readCheck.reason);
    const writeCheck = deps.policy.check({ path: destination, op: 'write', agentId: ctx.invokeId });
    if (writeCheck.decision === 'deny') return errorJSON(writeCheck.reason);

    try { await lstat(source); } catch { return errorJSON(`NOT_FOUND: ${source}`); }

    const destParent = dirname(destination);
    let parentInfo;
    try { parentInfo = await lstat(destParent); } catch {
      return errorJSON(`PARENT_NOT_FOUND: parent directory '${destParent}' does not exist. Use file.mkdir first.`);
    }
    if (!parentInfo.isDirectory()) {
      return errorJSON(`PARENT_NOT_FOUND: parent directory '${destParent}' does not exist. Use file.mkdir first.`);
    }

    let destExists = false;
    try { await lstat(destination); destExists = true; } catch { /* not exists */ }
    if (destExists) {
      if (!overwrite) return errorJSON(`CONFLICT: destination '${destination}' already exists`);
      await rm(destination, { recursive: true, force: true });
    }

    try { await cp(source, destination, { recursive: true, errorOnExist: false }); } catch (err) {
      return errorJSON((err as Error).message);
    }
    return okJSON({ source, destination });
  };
}
