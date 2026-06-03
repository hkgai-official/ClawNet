/**
 * Tag context for social-identity-based workspace isolation.
 *
 * A "tag" represents a social identity (e.g., "work", "life") that constrains
 * the agent's workspace, persona, memory, and file access per conversation.
 *
 * Tag context is resolved by the server and passed to the gateway so that
 * sessions load the correct workspace bootstrap files.
 */

export type TagNodeAcl = {
  allowedPaths: string[];
  deniedPaths: string[];
};

export type TagContext = {
  /** Server-side tag ID (UUID string). */
  tagId: string;
  /** Human-readable tag name (slug, e.g. "work"). */
  tagName: string;
  /** Display name (e.g. "工作"). */
  tagDisplayName?: string;
  /** Tag workspace ID — maps to ~/.openclaw/workspace/{workspaceId}/. */
  workspaceId: string;
  /** Node ACL for file-access enforcement (defense-in-depth). */
  nodeAcl?: TagNodeAcl;
  /** Access mode: "rw" (read-write, default) or "ro" (read-only for delegate agents). */
  accessMode?: "rw" | "ro";
  /** True when this session is responding to an A2A (agent-to-agent) dialog request.
   *  A2A mode applies stricter security restrictions (e.g., block config/env access). */
  a2aMode?: boolean;
  /** True when this tag is the main agent tag — sandbox root is widened to the entire
   *  workspace directory so the agent can read all tag workspaces. */
  isMain?: boolean;
};

/**
 * Per-session tag context storage.
 *
 * Keyed by session key. Set when the server provides tag context for a
 * conversation, and read during workspace resolution and node.invoke ACL checks.
 */
const sessionTagContextMap = new Map<string, TagContext>();

export function setSessionTagContext(sessionKey: string, ctx: TagContext): void {
  sessionTagContextMap.set(sessionKey, ctx);
}

export function getSessionTagContext(sessionKey: string): TagContext | undefined {
  return sessionTagContextMap.get(sessionKey);
}

export function clearSessionTagContext(sessionKey: string): void {
  sessionTagContextMap.delete(sessionKey);
}

/** Validate a file path against a tag's node ACL and access mode. */
export function validateTagNodeAcl(
  acl: TagNodeAcl,
  requestedPath: string,
  operation?: "read" | "write",
  accessMode?: "rw" | "ro",
): { allowed: boolean; reason: string } {
  // Read-only mode: reject all write operations.
  // When accessMode is undefined, default to "rw" (full access).
  const effectiveMode = accessMode ?? "rw";
  if (effectiveMode === "ro" && operation === "write") {
    return { allowed: false, reason: "read-only mode: write operations are denied" };
  }

  for (const pattern of acl.deniedPaths) {
    if (fnmatchSimple(requestedPath, pattern)) {
      return { allowed: false, reason: `denied by tag ACL pattern: ${pattern}` };
    }
  }
  for (const pattern of acl.allowedPaths) {
    if (fnmatchSimple(requestedPath, pattern)) {
      return { allowed: true, reason: "allowed by tag ACL" };
    }
    // Directory prefix matching: /home/user/work allows /home/user/work/file.txt
    const clean = pattern.replace(/\/+$/, "");
    if (!clean.includes("*") && !clean.includes("?") && !clean.includes("[")) {
      if (requestedPath.startsWith(clean + "/")) {
        return { allowed: true, reason: "allowed by tag ACL (dir prefix)" };
      }
    }
  }
  return { allowed: false, reason: "not in tag ACL allowed paths" };
}

/** Minimal fnmatch-style glob matching (supports * and ? wildcards). */
function fnmatchSimple(path: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`).test(path);
}
