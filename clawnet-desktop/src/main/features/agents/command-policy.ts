import { win32 } from 'node:path';
import type { BookmarkStore } from '../../store/bookmark-store';
import type { FileAccessSettings } from '../../../shared/domain/file-access';
import type { NodeAcl } from '../../../shared/domain/tag';

export type Decision = 'allow' | 'deny';

export interface PolicyResult {
  decision: Decision;
  reason: string;
}

export interface CommandPolicyOptions {
  bookmarks: BookmarkStore;
  serverSettings: FileAccessSettings | null;
}

// Default-deny path prefixes (Windows + macOS dev). Matched case-insensitively.
const DEFAULT_DENY_PREFIXES: string[] = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  // %USERPROFILE%\.ssh — anything containing \.ssh subpath
];

// Default-deny file patterns (matched on basename, case-insensitive).
const DEFAULT_DENY_PATTERNS: RegExp[] = [
  /\.pfx$/i,
  /\.p12$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.ppk$/i,
  /\.kdbx$/i,
  /^id_rsa/i,
  /^id_ed25519/i,
];

function norm(p: string): string {
  return win32.resolve(p).toLowerCase();
}

function isUnderPrefix(reqNormalized: string, prefix: string): boolean {
  const p = norm(prefix);
  if (reqNormalized === p) return true;
  return reqNormalized.startsWith(p + win32.sep.toLowerCase());
}

function isInSshDir(reqNormalized: string): boolean {
  return reqNormalized.includes(win32.sep.toLowerCase() + '.ssh' + win32.sep.toLowerCase())
    || reqNormalized.endsWith(win32.sep.toLowerCase() + '.ssh');
}

export class CommandPolicy {
  constructor(private readonly opts: CommandPolicyOptions) {}

  check(req: { path: string; op: string; agentId: string }): PolicyResult {
    const reqNormalized = norm(req.path);
    const base = win32.basename(req.path);

    // 1. Default-deny prefixes
    for (const prefix of DEFAULT_DENY_PREFIXES) {
      if (isUnderPrefix(reqNormalized, prefix)) {
        return { decision: 'deny', reason: 'default-denied' };
      }
    }
    if (isInSshDir(reqNormalized)) {
      return { decision: 'deny', reason: 'default-denied' };
    }

    // 2. Server-side denied paths (always deny — applies in every mode)
    const ss = this.opts.serverSettings;
    if (ss) {
      for (const denied of ss.deniedPaths) {
        if (isUnderPrefix(reqNormalized, denied)) {
          return { decision: 'deny', reason: 'server-denied' };
        }
      }
    }

    // 3. Server-side mode gate (mirrors macOS CommandPolicy.FileAccessMode):
    //    - deny   : everything denied after the denied-paths check above
    //    - scoped : path must be under an allowed_paths entry
    //    - full   : no additional gate beyond denied_paths
    if (ss) {
      if (ss.mode === 'deny') {
        return { decision: 'deny', reason: 'server-denied' };
      }
      if (ss.mode === 'scoped') {
        const inAllowed = ss.allowedPaths.some((p) => isUnderPrefix(reqNormalized, p));
        if (!inAllowed) {
          return { decision: 'deny', reason: 'server-denied' };
        }
      }
    }

    // NOTE: Win used to have a local-bookmark gate here (`pending-consent`)
    // intended for a runtime consent UI flow. That UI was wired to a
    // server push `agent.command.fileAccess` which the server has never
    // emitted — confirmed by grep against clawnet-server. The whole
    // consent UI infrastructure was removed in PR #41 (commit 896ed37),
    // but the policy-side gate was missed. With the gate in place and the
    // UI gone, every file invoke on a path the user hasn't manually added
    // to BookmarkStore via the Settings panel was rejected as
    // `pending-consent`, even when the server's `fileAccess.allowedPaths`
    // already authorised the path. Swift macOS CommandPolicy.swift has
    // no equivalent gate — server fileAccess is the source of truth.
    // Removing the gate brings us in line with Swift; BookmarkStore is
    // still used for workspace-root resolution (workspace-data.ts).

    // 4. File-pattern deny (applied after path is otherwise allowed)
    for (const pat of DEFAULT_DENY_PATTERNS) {
      if (pat.test(base)) {
        return { decision: 'deny', reason: 'default-denied-pattern' };
      }
    }

    return { decision: 'allow', reason: 'ok' };
  }

  /**
   * Intersect the global policy with a tag's NodeAcl. Mirrors macOS
   * CommandPolicy.swift:96-141.
   *
   * Order:
   *   1. Global policy first — global deny wins (returned verbatim).
   *   2. accessMode === 'ro' rejects writes for delegate agents.
   *   3. Tag deniedPaths matched against the normalized path.
   *   4. Empty tag allowedPaths means "this tag forbids everything".
   *   5. Match against tag allowedPaths (directory prefix).
   *   6. Default deny.
   */
  checkWithTagAcl(
    req: { path: string; op: string; agentId: string },
    tagAcl: NodeAcl,
  ): PolicyResult {
    const global = this.check(req);
    if (global.decision === 'deny') return global;

    if (tagAcl.accessMode === 'ro' && req.op === 'write') {
      return { decision: 'deny', reason: 'tag-acl-read-only' };
    }

    const reqNorm = norm(req.path);
    for (const pattern of tagAcl.deniedPaths) {
      if (isUnderPrefix(reqNorm, pattern)) {
        return { decision: 'deny', reason: 'tag-acl-denied' };
      }
    }

    if (tagAcl.allowedPaths.length === 0) {
      return { decision: 'deny', reason: 'tag-acl-no-allowed-paths' };
    }

    for (const pattern of tagAcl.allowedPaths) {
      if (isUnderPrefix(reqNorm, pattern)) {
        return { decision: 'allow', reason: 'tag-acl-allowed' };
      }
    }

    return { decision: 'deny', reason: 'tag-acl-not-allowed' };
  }

  updateServerSettings(s: FileAccessSettings | null): void {
    (this.opts as { serverSettings: FileAccessSettings | null }).serverSettings = s;
  }
}
