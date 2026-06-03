// src/main/features/agents/snapshot.ts
//
// 1:1 port of macOS NodeEventHandler.preWriteBackup (lines 250-271) +
// UndoValidator._internal.restore_snapshot (lines 467-480).

import { stat, cp, rm, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { snapshotsDir, ensureDirectory } from '../../utils/workspace-data';

/**
 * Snapshot a file's pre-write state to <wsRoot>/.clawnet/snapshots/<opId>/<basename>.
 * No-op when the file doesn't exist (new-file writes don't need snapshots).
 * Best-effort: errors are silently swallowed.
 */
export async function preWriteBackup(path: string, opId: string, wsRoot: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    return;
  }
  const snapDir = join(snapshotsDir(wsRoot), opId);
  try {
    await ensureDirectory(snapDir);
    await cp(path, join(snapDir, basename(path)), { recursive: true, force: true });
  } catch {
    // best-effort; failure does not abort the write
  }
}

/**
 * Restore a file from its snapshot. Throws on failure (caller is undo flow
 * which surfaces the error).
 */
export async function restoreSnapshot(target: string, opId: string, wsRoot: string): Promise<void> {
  const snapDir = join(snapshotsDir(wsRoot), opId);
  const entries = await readdir(snapDir);
  if (entries.length === 0) {
    throw new Error(`snapshot empty: ${opId}`);
  }
  const snapFile = join(snapDir, entries[0]!);
  await rm(target, { force: true, recursive: true });
  await cp(snapFile, target, { recursive: true, force: true });
  await rm(snapDir, { recursive: true, force: true });
}
