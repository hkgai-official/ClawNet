// src/main/features/agents/node-event-handler.ts
//
// 1:1 port of macOS NodeEventHandler.swift:23-90 (the inbound dispatch
// half). Subscribes to `node.invoke.request` push events, parses the
// payload, routes to a per-command handler, and writes back the result
// via `node.invoke.result` (an outbound JSON-RPC request frame).
//
// Real command implementations (file.search, file.read, etc.) are
// per-phase sub-features that pass their handler into the `commands`
// map at construction time. This module is purely the router + protocol
// bridge — no filesystem logic lives here.

import { z } from 'zod';
import type { PushDispatcher } from '../../network/gateway/push';
import { NodeAclSchema, type NodeAcl } from '../../../shared/domain/tag';
import { setWorkspaceRootHint, findWorkspaceRoot, clawnetDir, ensureDirectory, type BookmarksLike } from '../../utils/workspace-data';
import type { FileAccessLike } from './commands/file-trash';
import type { BlobEndpoint } from './blob-endpoint';
import { OperationLogger, generateOperationId, type LogEntry } from '../../store/operation-logger';
import { LOGGABLE_COMMANDS, paramsToJSONValues } from '../../../shared/domain/operation';
import { preWriteBackup } from './snapshot';
import { buildReverseAction } from './reverse-action';

const NodeInvokePayloadSchema = z.object({
  id: z.string(),
  command: z.string(),
  paramsJSON: z.string().optional(),
  workspaceRoot: z.string().optional(),
  tagNodeAcl: z.unknown().optional(),
});

export interface DispatchPolicyLike {
  checkWithTagAcl(
    req: { path: string; op: string; agentId: string },
    acl: NodeAcl,
  ): { decision: string; reason: string };
}

const FILE_WRITE_COMMANDS = new Set(['file.write', 'file.trash', 'file.move', 'file.rename']);

function inferPathOp(command: string): 'read' | 'write' {
  return FILE_WRITE_COMMANDS.has(command) ? 'write' : 'read';
}

interface ExtractedPaths {
  path?: string;
  source?: string;
  destination?: string;
}

function extractPaths(paramsJSON: string | undefined): ExtractedPaths {
  if (!paramsJSON) return {};
  try {
    const raw = JSON.parse(paramsJSON) as Record<string, unknown>;
    const out: ExtractedPaths = {};
    if (typeof raw.path === 'string') out.path = raw.path;
    if (typeof raw.source === 'string') out.source = raw.source;
    if (typeof raw.destination === 'string') out.destination = raw.destination;
    return out;
  } catch {
    return {};
  }
}

export interface NodeCommandContext {
  invokeId: string;
  paramsJSON?: string;
  workspaceRoot?: string;
  tagNodeAcl?: unknown;
  blobEndpoint?: BlobEndpoint;
}

export interface NodeCommandHandler {
  /** Returns a JSON-string (the `result` field of node.invoke.result). */
  (ctx: NodeCommandContext): Promise<string>;
}

export interface NodeEventChannel {
  sendRequest(method: string, params: Record<string, unknown>): void;
}

export interface NodeEventHandlerOptions {
  dispatcher: PushDispatcher;
  channel: NodeEventChannel;
  commands: Record<string, NodeCommandHandler>;
  policy?: DispatchPolicyLike;
  fileAccess?: FileAccessLike;
  bookmarks?: BookmarksLike;
  getBlobEndpoint?: () => BlobEndpoint | null;
  logger?: OperationLogger;
  getCurrentSessionId?: () => string | null;
}

export class NodeEventHandler {
  constructor(opts: NodeEventHandlerOptions) {
    opts.dispatcher.subscribe('node.invoke.request', (payload) => {
      void this.handle(payload, opts);
    });
  }

  private async handle(payload: unknown, opts: NodeEventHandlerOptions): Promise<void> {
    const parsed = NodeInvokePayloadSchema.safeParse(payload);
    if (!parsed.success) return;

    const { id, command, paramsJSON, workspaceRoot, tagNodeAcl } = parsed.data;

    // P3C-FileTrash: register workspace-root hints from tag ACL allowedPaths
    // (non-glob only). Mirrors macOS NodeEventHandler.swift:36-45.
    const aclParse = NodeAclSchema.safeParse(tagNodeAcl);
    if (aclParse.success) {
      for (const p of aclParse.data.allowedPaths) {
        if (!p.includes('*') && !p.includes('?')) {
          setWorkspaceRootHint(p);
        }
      }
    }

    // P3C-FileTrash / P3C-NodeEvent: dispatch-layer tag-ACL gate for file.* commands.
    // Mirrors macOS NodeEventHandler.swift:99-118. Checks path (single-path commands),
    // source (read op), and destination (write op) for move/copy. The per-command
    // handler still runs its own global policy.check (defense in depth).
    if (command.startsWith('file.') && opts.policy && aclParse.success) {
      const paths = extractPaths(paramsJSON);
      const checks: Array<{ kind: 'path' | 'source' | 'destination'; path: string; op: 'read' | 'write' }> = [];
      if (paths.path !== undefined) {
        checks.push({ kind: 'path', path: paths.path, op: inferPathOp(command) });
      }
      if (paths.source !== undefined) {
        checks.push({ kind: 'source', path: paths.source, op: 'read' });
      }
      if (paths.destination !== undefined) {
        checks.push({ kind: 'destination', path: paths.destination, op: 'write' });
      }
      for (const c of checks) {
        const result = opts.policy.checkWithTagAcl({ path: c.path, op: c.op, agentId: id }, aclParse.data);
        if (result.decision === 'deny') {
          const label = c.kind === 'path' ? '' : ` (${c.kind})`;
          opts.channel.sendRequest('node.invoke.result', {
            id,
            result: JSON.stringify({ error: `Tag ACL denied${label}: ${result.reason}` }),
          });
          return;
        }
      }
    }

    // P3C-NodeEvent: eagerly ensure .clawnet/ exists for file.* commands.
    // Mirrors macOS NodeEventHandler.swift:120-133. Resolves workspace root
    // from path/source/destination and ensures .clawnet/ exists before handler
    // dispatch. Best-effort and non-blocking: failure is swallowed.
    if (command.startsWith('file.')) {
      const paths = extractPaths(paramsJSON);
      const candidates = [paths.path, paths.source, paths.destination].filter(
        (p): p is string => typeof p === 'string',
      );
      const fileAccessSettings = opts.fileAccess?.getEffectiveSettings() ?? null;
      void (async () => {
        for (const cand of candidates) {
          const wsRoot = await findWorkspaceRoot(cand, { fileAccess: fileAccessSettings, ...(opts.bookmarks ? { bookmarks: opts.bookmarks } : {}) });
          if (wsRoot) {
            await ensureDirectory(clawnetDir(wsRoot)).catch(() => undefined);
            break;
          }
        }
      })();
    }

    // P3C-Ops: pre-handler logging hook — opId + preWriteBackup
    let opId: string | null = null;
    const isLoggable = LOGGABLE_COMMANDS.has(command) && opts.logger !== undefined;
    let parsedParams: Record<string, unknown> = {};
    if (paramsJSON) { try { parsedParams = JSON.parse(paramsJSON) as Record<string, unknown>; } catch { /* keep empty */ } }

    if (isLoggable) {
      opId = generateOperationId();
      if (command === 'file.write') {
        const path = typeof parsedParams.path === 'string' ? parsedParams.path : null;
        const isAppend = parsedParams.append === true;
        if (path && !isAppend) {
          const fileAccessSettings = opts.fileAccess?.getEffectiveSettings() ?? null;
          const wsRoot = await findWorkspaceRoot(path, { fileAccess: fileAccessSettings, ...(opts.bookmarks ? { bookmarks: opts.bookmarks } : {}) });
          if (wsRoot) {
            await preWriteBackup(path, opId, wsRoot);
          }
        }
      }
    }

    const handler = opts.commands[command];

    let result: string;
    if (!handler) {
      result = JSON.stringify({ error: `unknown_command: ${command}` });
    } else {
      try {
        const ctx: NodeCommandContext = { invokeId: id };
        if (paramsJSON !== undefined) ctx.paramsJSON = paramsJSON;
        if (workspaceRoot !== undefined) ctx.workspaceRoot = workspaceRoot;
        if (tagNodeAcl !== undefined) ctx.tagNodeAcl = tagNodeAcl;
        const ep = opts.getBlobEndpoint?.();
        if (ep) ctx.blobEndpoint = ep;
        result = await handler(ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result = JSON.stringify({ error: message });
      }
    }

    // P3C-Ops: post-handler logging hook
    if (isLoggable && opId && opts.logger) {
      let resultObj: Record<string, unknown> = {};
      try { resultObj = JSON.parse(result) as Record<string, unknown>; } catch { /* not JSON */ }
      const isSuccess = typeof resultObj.error !== 'string';

      const candidatePaths = [
        typeof parsedParams.path === 'string' ? parsedParams.path : null,
        typeof parsedParams.source === 'string' ? parsedParams.source : null,
        typeof parsedParams.destination === 'string' ? parsedParams.destination : null,
      ].filter((p): p is string => typeof p === 'string');
      const fileAccessSettings = opts.fileAccess?.getEffectiveSettings() ?? null;
      let logWsRoot: string | null = null;
      for (const p of candidatePaths) {
        const found = await findWorkspaceRoot(p, { fileAccess: fileAccessSettings, ...(opts.bookmarks ? { bookmarks: opts.bookmarks } : {}) });
        if (found) { logWsRoot = found; break; }
      }

      if (logWsRoot) {
        const reverseAction = isSuccess
          ? await buildReverseAction(command, parsedParams, opId, logWsRoot, result)
          : null;
        const entry: LogEntry = {
          id: opId,
          timestamp: Date.now(),
          command,
          params: paramsToJSONValues(parsedParams),
          result: isSuccess ? 'success' : 'error',
          reversible: reverseAction !== null,
        };
        const sid = opts.getCurrentSessionId?.() ?? null;
        if (sid) entry.sessionId = sid;
        if (reverseAction) entry.reverseAction = reverseAction;
        if (!isSuccess && typeof resultObj.error === 'string') entry.errorMessage = resultObj.error;
        await opts.logger.log(entry, logWsRoot);

        if (isSuccess) {
          result = JSON.stringify({ ...resultObj, operationId: opId });
        }
      }
    }

    opts.channel.sendRequest('node.invoke.result', { id, result });
  }
}
