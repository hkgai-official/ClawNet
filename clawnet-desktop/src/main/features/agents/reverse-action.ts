// src/main/features/agents/reverse-action.ts
//
// 1:1 port of macOS NodeEventHandler.buildReverseAction (lines 275-346).

import { stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { snapshotsDir } from '../../utils/workspace-data';
import type { ReverseAction, JSONValue } from '../../../shared/domain/operation';

function jv(v: unknown): JSONValue {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
  return null;
}

export async function buildReverseAction(
  command: string,
  params: Record<string, unknown>,
  opId: string,
  wsRoot: string,
  resultJSON: string,
): Promise<ReverseAction | null> {
  switch (command) {
    case 'file.move': {
      const source = jv(params.source);
      const destination = jv(params.destination);
      if (typeof source !== 'string' || typeof destination !== 'string') return null;
      return { command: 'file.move', params: { source: destination, destination: source } };
    }

    case 'file.rename': {
      const path = jv(params.path);
      const newName = jv(params.newName);
      if (typeof path !== 'string' || typeof newName !== 'string') return null;
      const newPath = join(dirname(path), newName);
      return { command: 'file.rename', params: { path: newPath, newName: basename(path) } };
    }

    case 'file.copy': {
      const destination = jv(params.destination);
      if (typeof destination !== 'string') return null;
      return { command: 'file.trash', params: { path: destination } };
    }

    case 'file.mkdir': {
      const path = jv(params.path);
      if (typeof path !== 'string') return null;
      return { command: '_internal.rmdir', params: { path } };
    }

    case 'file.write': {
      const path = jv(params.path);
      const isAppend = jv(params.append) === true;
      if (isAppend) return null;
      if (typeof path !== 'string') return null;
      const snapDir = join(snapshotsDir(wsRoot), opId);
      try {
        await stat(snapDir);
        return { command: '_internal.restore_snapshot', params: { path, opId } };
      } catch {
        return { command: 'file.trash', params: { path } };
      }
    }

    case 'file.trash': {
      const path = jv(params.path);
      if (typeof path !== 'string') return null;
      try {
        const obj = JSON.parse(resultJSON) as Record<string, unknown>;
        if (typeof obj.trashId !== 'string') return null;
        return { command: '_internal.restore_trash', params: { trashId: obj.trashId, originalPath: path } };
      } catch {
        return null;
      }
    }

    default:
      return null;
  }
}
