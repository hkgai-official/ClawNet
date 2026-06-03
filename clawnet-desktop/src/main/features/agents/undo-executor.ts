// src/main/features/agents/undo-executor.ts
//
// Validate + execute a ReverseAction. 1:1 port of macOS UndoValidator
// .validate (OpsCommandHandler.swift:318-419) + .performUndo (lines 421-489),
// merged into a single async dispatcher.

import { stat, rename, rmdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { restoreSnapshot } from './snapshot';
import { restoreFromTrash } from './commands/file-trash';
import { trashDir, generateTrashId, ensureDirectory } from '../../utils/workspace-data';
import { serializeTrashMeta } from '../../../shared/domain/trash';
import type { ReverseAction } from '../../../shared/domain/operation';

export interface UndoExecutorDeps {
  policy?: unknown;
}

export async function executeReverseAction(
  action: ReverseAction,
  wsRoot: string,
  _deps: UndoExecutorDeps,
): Promise<void> {
  switch (action.command) {
    case 'file.move': {
      const source = String(action.params.source);
      const destination = String(action.params.destination);
      try { await stat(source); } catch { throw new Error(`CONFLICT: file no longer at '${source}'`); }
      try {
        await stat(destination);
        throw new Error(`CONFLICT: original path '${destination}' is occupied`);
      } catch (err) {
        if ((err as Error).message?.startsWith('CONFLICT:')) throw err;
      }
      await rename(source, destination);
      return;
    }

    case 'file.rename': {
      const path = String(action.params.path);
      const newName = String(action.params.newName);
      try { await stat(path); } catch { throw new Error(`CONFLICT: renamed file '${path}' no longer exists`); }
      const dest = join(dirname(path), newName);
      try {
        await stat(dest);
        throw new Error(`CONFLICT: original name '${newName}' is occupied`);
      } catch (err) {
        if ((err as Error).message?.startsWith('CONFLICT:')) throw err;
      }
      await rename(path, dest);
      return;
    }

    case 'file.trash': {
      const path = String(action.params.path);
      try { await stat(path); } catch { throw new Error(`CONFLICT: file '${path}' no longer exists`); }
      const trashId = generateTrashId();
      const entryDir = join(trashDir(wsRoot), trashId);
      await ensureDirectory(entryDir);
      const meta = serializeTrashMeta({ originalPath: path, trashedAt: Date.now(), sessionId: null });
      await writeFile(join(entryDir, '_meta.json'), meta, 'utf-8');
      await rename(path, join(entryDir, basename(path)));
      return;
    }

    case '_internal.rmdir': {
      const path = String(action.params.path);
      let info;
      try { info = await stat(path); } catch { throw new Error(`CONFLICT: directory '${path}' no longer exists`); }
      if (!info.isDirectory()) throw new Error(`CONFLICT: '${path}' is not a directory`);
      const contents = await readdir(path);
      if (contents.length > 0) throw new Error(`CONFLICT: directory '${path}' is not empty (${contents.length} items)`);
      await rmdir(path);
      return;
    }

    case '_internal.restore_snapshot': {
      const path = String(action.params.path);
      const opId = String(action.params.opId);
      await restoreSnapshot(path, opId, wsRoot);
      return;
    }

    case '_internal.restore_trash': {
      const trashId = String(action.params.trashId);
      await restoreFromTrash(trashId, wsRoot);
      return;
    }

    default:
      throw new Error(`unknown reverse command: ${action.command}`);
  }
}
