// src/main/utils/workspace-data.ts
//
// Workspace-root resolution + .clawnet directory conventions. Ports macOS
// ClawNetDataManager.swift:43-145. Resolution chain (longest-prefix wins
// within each step; first step to hit returns):
//   1. setWorkspaceRootHint registrations
//   2. .clawnet/ ancestor walk
//   3. fileAccess.allowedPaths (non-glob entries)
//   4. BookmarkStore.list() — paths granted via the consent UI flow
//
// No chmod 700 on created directories — macOS doesn't either.

import { mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { win32 } from 'node:path';
import { randomBytes } from 'node:crypto';

const CLAWNET_DIR_NAME = '.clawnet';
const TRASH_DIR_NAME = 'trash';
const ANCESTOR_WALK_MAX = 20;

const hints = new Map<string, string>(); // key = normalized prefix, value = original

function norm(p: string): string {
  return win32.resolve(p).toLowerCase();
}

function isUnderPrefix(targetNorm: string, prefix: string): boolean {
  const pNorm = norm(prefix);
  if (targetNorm === pNorm) return true;
  return targetNorm.startsWith(pNorm + win32.sep.toLowerCase());
}

export function setWorkspaceRootHint(rootPath: string): void {
  hints.set(norm(rootPath), rootPath);
}

export function clearWorkspaceRootHints(): void {
  hints.clear();
}

export interface BookmarksLike {
  list(): { path: string }[];
}

export interface WorkspaceRootContext {
  fileAccess?: { allowedPaths: string[] } | null | undefined;
  bookmarks?: BookmarksLike | null | undefined;
}

export async function findWorkspaceRoot(
  targetPath: string,
  ctx: WorkspaceRootContext,
): Promise<string | null> {
  const targetNorm = norm(targetPath);

  // 1. Hint match — longest matching hint wins.
  let best: { prefixNorm: string; orig: string } | null = null;
  for (const [prefixNorm, orig] of hints) {
    if (isUnderPrefix(targetNorm, orig)) {
      if (!best || prefixNorm.length > best.prefixNorm.length) {
        best = { prefixNorm, orig };
      }
    }
  }
  if (best) return best.orig;

  // 2. Walk up looking for .clawnet directory.
  let current = dirname(targetPath);
  for (let i = 0; i < ANCESTOR_WALK_MAX; i++) {
    const candidate = join(current, CLAWNET_DIR_NAME);
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) return current;
    } catch { /* not found, keep walking */ }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // 3. fileAccess.allowedPaths longest non-glob match.
  if (ctx.fileAccess?.allowedPaths?.length) {
    let bestAllow: { prefixNorm: string; orig: string } | null = null;
    for (const allowed of ctx.fileAccess.allowedPaths) {
      if (allowed.includes('*') || allowed.includes('?')) continue;
      if (isUnderPrefix(targetNorm, allowed)) {
        const prefixNorm = norm(allowed);
        if (!bestAllow || prefixNorm.length > bestAllow.prefixNorm.length) {
          bestAllow = { prefixNorm, orig: allowed };
        }
      }
    }
    if (bestAllow) return bestAllow.orig;
  }

  // 4. BookmarkStore: paths granted via the consent UI flow. Same
  // longest-prefix rule as Step 3.
  if (ctx.bookmarks) {
    let bestBm: { prefixNorm: string; orig: string } | null = null;
    for (const entry of ctx.bookmarks.list()) {
      if (isUnderPrefix(targetNorm, entry.path)) {
        const prefixNorm = norm(entry.path);
        if (!bestBm || prefixNorm.length > bestBm.prefixNorm.length) {
          bestBm = { prefixNorm, orig: entry.path };
        }
      }
    }
    if (bestBm) return bestBm.orig;
  }

  return null;
}

export function clawnetDir(wsRoot: string): string {
  return join(wsRoot, CLAWNET_DIR_NAME);
}

export function trashDir(wsRoot: string): string {
  return join(clawnetDir(wsRoot), TRASH_DIR_NAME);
}

export function logsDir(wsRoot: string): string {
  return join(clawnetDir(wsRoot), 'logs');
}

export function snapshotsDir(wsRoot: string): string {
  return join(clawnetDir(wsRoot), 'snapshots');
}

export function generateTrashId(now: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const y = now.getUTCFullYear();
  const M = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const h = pad(now.getUTCHours());
  const m = pad(now.getUTCMinutes());
  const s = pad(now.getUTCSeconds());
  const hex = randomBytes(2).toString('hex'); // 4 hex chars
  return `${y}${M}${d}_${h}${m}${s}_${hex}`;
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function listTrashEntries(wsRoot: string): Promise<string[]> {
  try {
    return await readdir(trashDir(wsRoot));
  } catch {
    return [];
  }
}
