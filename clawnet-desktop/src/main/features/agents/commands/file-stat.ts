// src/main/features/agents/commands/file-stat.ts
//
// 1:1 port of macOS FileCommandHandler.swift:128-173.

import { z } from 'zod';
import { lstat, access } from 'node:fs/promises';
import { constants as fsConst } from 'node:fs';
import type { NodeCommandHandler, NodeCommandContext } from '../node-event-handler';

export interface CommandPolicyLike {
  check(req: { path: string; op: string; agentId: string }): { decision: string; reason: string };
}

export interface FileStatHandlerDeps {
  policy: CommandPolicyLike;
}

const ParamsSchema = z.object({ path: z.string().min(1) });

function errorJSON(msg: string): string { return JSON.stringify({ error: msg }); }
function okJSON(d: Record<string, unknown>): string { return JSON.stringify(d); }

export function makeFileStatHandler(deps: FileStatHandlerDeps): NodeCommandHandler {
  return async (ctx: NodeCommandContext) => {
    if (!ctx.paramsJSON) return errorJSON('missing path');
    let raw: unknown;
    try { raw = JSON.parse(ctx.paramsJSON); } catch { return errorJSON('invalid params'); }
    const parsed = ParamsSchema.safeParse(raw);
    if (!parsed.success) {
      if (parsed.error.issues.some((i) => i.path[0] === 'path')) return errorJSON('missing path');
      return errorJSON('invalid params');
    }
    const path = parsed.data.path;

    const accessCheck = deps.policy.check({ path, op: 'read', agentId: ctx.invokeId });
    if (accessCheck.decision === 'deny') return errorJSON(accessCheck.reason);

    let info;
    try { info = await lstat(path); } catch { return errorJSON(`NOT_FOUND: ${path}`); }

    let type: 'file' | 'directory' | 'symlink';
    if (info.isSymbolicLink()) type = 'symlink';
    else if (info.isDirectory()) type = 'directory';
    else type = 'file';

    const readable = await access(path, fsConst.R_OK).then(() => true).catch(() => false);
    const writable = await access(path, fsConst.W_OK).then(() => true).catch(() => false);

    return okJSON({
      path,
      type,
      size: info.size,
      permissions: info.mode & 0o777,
      readable,
      writable,
      createdAt: info.birthtimeMs,
      modifiedAt: info.mtimeMs,
    });
  };
}
