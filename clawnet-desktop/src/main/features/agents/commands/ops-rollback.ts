// src/main/features/agents/commands/ops-rollback.ts
//
// 1:1 port of macOS OpsCommandHandler.handleOpsRollback (lines 148-278).

import { z } from 'zod';
import type { NodeCommandHandler, NodeCommandContext } from '../node-event-handler';
import { OperationLogger, generateOperationId } from '../../../store/operation-logger';
import { findWorkspaceRoot, logsDir, type BookmarksLike } from '../../../utils/workspace-data';
import { stat } from 'node:fs/promises';
import type { ReverseAction, LogEntry } from '../../../../shared/domain/operation';
import { paramsToJSONValues } from '../../../../shared/domain/operation';

export interface FileAccessLike {
  getEffectiveSettings(): { allowedPaths: string[] } | null;
}

export type UndoExecutorFn = (
  action: ReverseAction,
  wsRoot: string,
  deps: { policy?: unknown },
) => Promise<void>;

export interface OpsRollbackHandlerDeps {
  logger: OperationLogger;
  undoExecutor: UndoExecutorFn;
  fileAccess: FileAccessLike;
  getCurrentSessionId: () => string | null;
  bookmarks?: BookmarksLike;
}

const ParamsSchema = z.object({
  sessionId: z.string().optional(),
  since: z.number().int().optional(),
  dryRun: z.boolean().optional(),
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

export function makeOpsRollbackHandler(deps: OpsRollbackHandlerDeps): NodeCommandHandler {
  return async (ctx: NodeCommandContext) => {
    let raw: unknown = {};
    if (ctx.paramsJSON) {
      try { raw = JSON.parse(ctx.paramsJSON); } catch { return errorJSON('invalid params'); }
    }
    const parsed = ParamsSchema.safeParse(raw);
    if (!parsed.success) return errorJSON('invalid params');
    const p = parsed.data;

    const wsRoot = await resolveOpsWsRoot(p, deps.fileAccess, deps.bookmarks);
    if (!wsRoot) return errorJSON('NO_WORKSPACE: cannot determine workspace');

    const dryRun = p.dryRun ?? true;
    const sessionId = p.sessionId ?? deps.getCurrentSessionId() ?? undefined;
    const since = p.since;

    if (sessionId === undefined && since === undefined) {
      return errorJSON('missing sessionId or since parameter (one is required)');
    }

    const filter = { sessionId, since, limit: 10000, offset: 0 };
    const queryResult = await deps.logger.query(filter, wsRoot);

    // Collect candidates — query returns desc (most-recent-first).
    const candidatesDesc: LogEntry[] = [];
    for (const e of queryResult.entries) {
      if (e.type !== undefined) continue;
      if (await deps.logger.isUndone(e.id, wsRoot)) continue;
      candidatesDesc.push(e);
    }
    // Execution iterates most-recent-first (desc) — same as macOS stack order.
    // This ensures chained ops undo correctly: e.g. file.copy (newest) is
    // trashed before file.write (older) is restored before file.mkdir (oldest)
    // is rmdired. Reversing to ASC would cause _internal.rmdir to fail with
    // "directory not empty" because its children have not been removed yet.

    if (dryRun) {
      const reversibleCount = candidatesDesc.filter((c) => c.reversible).length;
      return okJSON({
        dryRun: true,
        operations: candidatesDesc.map((c) => {
          const o: Record<string, unknown> = { id: c.id, command: c.command, reversible: c.reversible };
          if (c.reverseAction) o.reverseAction = c.reverseAction;
          return o;
        }),
        totalOperations: candidatesDesc.length,
        reversibleCount,
        irreversibleCount: candidatesDesc.length - reversibleCount,
      });
    }

    let undoneCount = 0;
    const failedOperations: Array<{ id: string; reason: string }> = [];

    for (const entry of candidatesDesc) {
      if (!entry.reversible || !entry.reverseAction) {
        failedOperations.push({ id: entry.id, reason: 'NOT_REVERSIBLE' });
        break;
      }
      try {
        await deps.undoExecutor(entry.reverseAction, wsRoot, {});
        const undoEntry: LogEntry = {
          id: generateOperationId(),
          timestamp: Date.now(),
          command: entry.command,
          params: entry.params,
          result: 'success',
          reversible: false,
          type: 'undo',
          undoTargetId: entry.id,
        };
        await deps.logger.log(undoEntry, wsRoot);
        undoneCount++;
      } catch (err) {
        failedOperations.push({ id: entry.id, reason: (err as Error).message ?? String(err) });
        break;
      }
    }

    const rollbackEntry: LogEntry = {
      id: generateOperationId(),
      timestamp: Date.now(),
      command: 'ops.rollback',
      params: paramsToJSONValues(raw as Record<string, unknown>),
      result: failedOperations.length === 0 ? 'success' : 'partial',
      reversible: false,
      type: 'rollback',
    };
    if (sessionId) rollbackEntry.sessionId = sessionId;
    if (failedOperations.length > 0) rollbackEntry.errorMessage = 'stopped at failed operation';
    await deps.logger.log(rollbackEntry, wsRoot);

    return okJSON({
      dryRun: false,
      undone: undoneCount,
      failed: failedOperations.length,
      failedOperations,
    });
  };
}
