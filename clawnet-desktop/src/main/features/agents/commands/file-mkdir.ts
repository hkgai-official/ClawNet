// src/main/features/agents/commands/file-mkdir.ts
//
// 1:1 port of macOS FileCommandHandler.swift:456-485.

import { z } from 'zod';
import { mkdir, lstat } from 'node:fs/promises';
import type { NodeCommandHandler, NodeCommandContext } from '../node-event-handler';

export interface CommandPolicyLike {
  check(req: { path: string; op: string; agentId: string }): { decision: string; reason: string };
}

export interface FileMkdirHandlerDeps {
  policy: CommandPolicyLike;
}

const ParamsSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional(),
});

function errorJSON(msg: string): string { return JSON.stringify({ error: msg }); }
function okJSON(d: Record<string, unknown>): string { return JSON.stringify(d); }

export function makeFileMkdirHandler(deps: FileMkdirHandlerDeps): NodeCommandHandler {
  return async (ctx: NodeCommandContext) => {
    if (!ctx.paramsJSON) return errorJSON('missing path');
    let raw: unknown;
    try { raw = JSON.parse(ctx.paramsJSON); } catch { return errorJSON('invalid params'); }
    const parsed = ParamsSchema.safeParse(raw);
    if (!parsed.success) {
      if (parsed.error.issues.some((i) => i.path[0] === 'path')) return errorJSON('missing path');
      return errorJSON('invalid params');
    }
    const { path, recursive = true } = parsed.data;

    const writeCheck = deps.policy.check({ path, op: 'write', agentId: ctx.invokeId });
    if (writeCheck.decision === 'deny') return errorJSON(writeCheck.reason);

    let info: import('node:fs').Stats | null = null;
    try { info = await lstat(path); } catch { /* not exists */ }
    if (info) {
      if (info.isDirectory()) return okJSON({ path, created: false });
      return errorJSON(`CONFLICT: path '${path}' exists and is a file, not a directory`);
    }

    try {
      await mkdir(path, { recursive });
    } catch (err) {
      return errorJSON((err as Error).message);
    }
    return okJSON({ path, created: true });
  };
}
