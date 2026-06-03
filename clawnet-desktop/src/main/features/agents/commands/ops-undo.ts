// src/main/features/agents/commands/ops-undo.ts
//
// 1:1 port of macOS OpsCommandHandler.handleOpsUndo (lines 67-144).

import { z } from 'zod';
import type { NodeCommandHandler, NodeCommandContext } from '../node-event-handler';
import { OperationLogger, generateOperationId } from '../../../store/operation-logger';
import { findWorkspaceRoot, logsDir, type BookmarksLike } from '../../../utils/workspace-data';
import { stat } from 'node:fs/promises';
import type { ReverseAction, LogEntry } from '../../../../shared/domain/operation';

export interface FileAccessLike {
  getEffectiveSettings(): { allowedPaths: string[] } | null;
}

export type UndoExecutorFn = (
  action: ReverseAction,
  wsRoot: string,
  deps: { policy?: unknown },
) => Promise<void>;

export interface OpsUndoHandlerDeps {
  logger: OperationLogger;
  undoExecutor: UndoExecutorFn;
  fileAccess: FileAccessLike;
  getCurrentSessionId: () => string | null;
  bookmarks?: BookmarksLike;
}

const ParamsSchema = z.object({
  operationId: z.string().min(1),
  path: z.string().optional(),
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

export function makeOpsUndoHandler(deps: OpsUndoHandlerDeps): NodeCommandHandler {
  return async (ctx: NodeCommandContext) => {
    if (!ctx.paramsJSON) return errorJSON('missing operationId');
    let raw: unknown;
    try { raw = JSON.parse(ctx.paramsJSON); } catch { return errorJSON('invalid params'); }
    const parsed = ParamsSchema.safeParse(raw);
    if (!parsed.success) {
      if (parsed.error.issues.some((i) => i.path[0] === 'operationId')) return errorJSON('missing operationId');
      return errorJSON('invalid params');
    }
    const { operationId } = parsed.data;
    const wsRoot = await resolveOpsWsRoot(parsed.data, deps.fileAccess, deps.bookmarks);
    if (!wsRoot) return errorJSON('NO_WORKSPACE: cannot determine workspace');

    const entry = await deps.logger.findEntry(operationId, wsRoot);
    if (!entry) return errorJSON(`NOT_FOUND: operation '${operationId}' not found`);

    const currentSid = deps.getCurrentSessionId();
    if (currentSid && entry.sessionId !== currentSid) {
      return errorJSON(`NOT_FOUND: operation '${operationId}' not found`);
    }

    if (!entry.reversible || !entry.reverseAction) {
      return errorJSON(`NOT_REVERSIBLE: operation '${operationId}' cannot be undone`);
    }

    if (await deps.logger.isUndone(operationId, wsRoot)) {
      return errorJSON(`ALREADY_UNDONE: operation '${operationId}' has already been undone`);
    }

    try {
      await deps.undoExecutor(entry.reverseAction, wsRoot, {});
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (msg.startsWith('CONFLICT:')) return errorJSON(msg);
      return errorJSON(`UNDO_FAILED: ${msg}`);
    }

    const undoEntry: LogEntry = {
      id: generateOperationId(),
      timestamp: Date.now(),
      command: entry.command,
      params: entry.params,
      result: 'success',
      reversible: false,
      type: 'undo',
      undoTargetId: operationId,
    };
    await deps.logger.log(undoEntry, wsRoot);

    return okJSON({ operationId, undone: true, reverseAction: entry.reverseAction });
  };
}
