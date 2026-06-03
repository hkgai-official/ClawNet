/**
 * Boundary violation reporting for tag workspace isolation.
 *
 * All gateway-side isolation checks (exec boundary, file workspace guard,
 * node ACL, sandbox path) funnel through {@link reportBoundaryViolation} so
 * that every denial is:
 *   1. logged locally via logWarn (file + console)
 *   2. broadcast as an "audit" gateway event for server persistence
 *
 * The broadcast function is registered once at gateway startup via
 * {@link registerBoundaryViolationBroadcast}.
 */

import { logWarn } from "../logger.js";
import type { GatewayBroadcastFn } from "../gateway/server-broadcast.js";
import { getSessionTagContext } from "../gateway/tag-context.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BoundaryViolationType =
  | "exec_workdir_escape"
  | "exec_command_path"
  | "exec_command_traversal"
  | "file_workspace_escape"
  | "node_acl_denied"
  | "node_workspace_isolation"
  | "sandbox_path_escape"
  | "a2a_command_restriction"
  | "a2a_write_denied";

export interface BoundaryViolation {
  type: BoundaryViolationType;
  sessionKey?: string;
  tagName?: string;
  tagWorkspaceId?: string;
  /** The allowed workspace boundary path. */
  boundary: string;
  /** The path or command fragment that was blocked. */
  attemptedPath: string;
  /** Human-readable description of the violation. */
  detail: string;
}

// ---------------------------------------------------------------------------
// Module-level broadcast registration
// ---------------------------------------------------------------------------

let _broadcast: GatewayBroadcastFn | null = null;

/**
 * Called once during gateway startup to inject the broadcast function.
 * This avoids threading a callback through every tool-creation call site.
 */
export function registerBoundaryViolationBroadcast(broadcast: GatewayBroadcastFn): void {
  _broadcast = broadcast;
}

// ---------------------------------------------------------------------------
// Rate-limiting (same sessionKey + type → 5 s cooldown)
// ---------------------------------------------------------------------------

const _recentViolations = new Map<string, number>();
const COOLDOWN_MS = 5_000;
const CLEANUP_INTERVAL_MS = 30_000;
const MAX_ENTRIES = 500;

function isDuplicate(violation: BoundaryViolation): boolean {
  const key = `${violation.sessionKey ?? ""}:${violation.type}`;
  const now = Date.now();
  const last = _recentViolations.get(key);
  if (last !== undefined && now - last < COOLDOWN_MS) {
    return true;
  }
  _recentViolations.set(key, now);
  return false;
}

// Periodic cleanup of expired entries.
setInterval(() => {
  if (_recentViolations.size === 0) return;
  const now = Date.now();
  for (const [key, ts] of _recentViolations) {
    if (now - ts > COOLDOWN_MS) _recentViolations.delete(key);
  }
}, CLEANUP_INTERVAL_MS).unref();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Report a workspace boundary violation. Fire-and-forget — never throws,
 * never blocks the caller's deny/throw flow.
 */
export function reportBoundaryViolation(violation: BoundaryViolation): void {
  try {
    // Resolve tagName: caller value → sessionKey lookup → tagWorkspaceId → "unresolved"
    let tagName = violation.tagName;
    let tagWorkspaceId = violation.tagWorkspaceId;
    if (!tagName && violation.sessionKey) {
      const ctx = getSessionTagContext(violation.sessionKey);
      if (ctx) {
        tagName = ctx.tagName;
        tagWorkspaceId = tagWorkspaceId ?? ctx.workspaceId;
      }
    }
    const resolvedTagName = tagName ?? tagWorkspaceId ?? "unresolved";

    // Always log locally regardless of rate-limit.
    logWarn(
      `[boundary-violation] type=${violation.type} tag=${resolvedTagName} ` +
        `path=${violation.attemptedPath} detail=${violation.detail}`,
    );

    if (isDuplicate(violation)) return;

    if (_broadcast) {
      _broadcast("audit", {
        violationType: violation.type,
        sessionKey: violation.sessionKey,
        tagName: resolvedTagName,
        tagWorkspaceId: tagWorkspaceId,
        boundary: violation.boundary,
        attemptedPath: violation.attemptedPath,
        detail: violation.detail,
        ts: Date.now(),
      });
    }
  } catch {
    // Swallow — reporting must never interfere with the denial itself.
  }
}
