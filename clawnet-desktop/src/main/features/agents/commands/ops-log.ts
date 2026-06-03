// src/main/features/agents/commands/ops-log.ts
//
// 1:1 port of macOS OpsCommandHandler.handleOpsLog (lines 11-63).

import { z } from 'zod';
import type { NodeCommandHandler, NodeCommandContext } from '../node-event-handler';
import type { OperationLogger } from '../../../store/operation-logger';
import { findWorkspaceRoot, logsDir, type BookmarksLike } from '../../../utils/workspace-data';
import { stat } from 'node:fs/promises';

export interface FileAccessLike {
  getEffectiveSettings(): { allowedPaths: string[] } | null;
}

export interface OpsLogHandlerDeps {
  logger: OperationLogger;
  fileAccess: FileAccessLike;
  getCurrentSessionId: () => string | null;
  bookmarks?: BookmarksLike;
}

const ParamsSchema = z.object({
  path: z.string().optional(),
  sessionId: z.string().optional(),
  command: z.string().optional(),
  since: z.number().int().optional(),
  until: z.number().int().optional(),
  limit: z.number().int().min(1).optional(),
  offset: z.number().int().min(0).optional(),
});

function errorJSON(msg: string): string { return JSON.stringify({ error: msg }); }
function okJSON(d: Record<string, unknown>): string { return JSON.stringify(d); }

async function resolveOpsWsRoot(
  params: { path?: string | undefined },
  fileAccess: FileAccessLike,
  bookmarks?: BookmarksLike,
): Promise<string | null> {
  const fileAccessSettings = fileAccess.getEffectiveSettings();
  if (params.path) {
    const r = await findWorkspaceRoot(params.path, {
      fileAccess: fileAccessSettings,
      ...(bookmarks ? { bookmarks } : {}),
    });
    if (r) return r;
  }
  if (fileAccessSettings?.allowedPaths) {
    for (const root of fileAccessSettings.allowedPaths) {
      if (root.includes('*') || root.includes('?')) continue;
      try { await stat(logsDir(root)); return root; } catch { /* skip */ }
    }
    for (const root of fileAccessSettings.allowedPaths) {
      if (!root.includes('*') && !root.includes('?')) return root;
    }
  }
  return null;
}

export function makeOpsLogHandler(deps: OpsLogHandlerDeps): NodeCommandHandler {
  return async (ctx: NodeCommandContext) => {
    let raw: unknown = {};
    if (ctx.paramsJSON) {
      try { raw = JSON.parse(ctx.paramsJSON); } catch { return errorJSON('invalid params'); }
    }
    const parsed = ParamsSchema.safeParse(raw);
    if (!parsed.success) return errorJSON('invalid params');
    const p = parsed.data;

    const wsRoot = await resolveOpsWsRoot(p, deps.fileAccess, deps.bookmarks);
    if (!wsRoot) return errorJSON("NO_WORKSPACE: cannot determine workspace. Provide a 'path' parameter or ensure a workspace is configured.");

    const filter = {
      sessionId: p.sessionId ?? deps.getCurrentSessionId() ?? undefined,
      command: p.command,
      since: p.since,
      until: p.until,
      limit: p.limit ?? 50,
      offset: p.offset ?? 0,
    };

    const result = await deps.logger.query(filter, wsRoot);
    return okJSON({ entries: result.entries, total: result.total, hasMore: result.hasMore });
  };
}
