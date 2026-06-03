// src/shared/domain/trash.ts
//
// 1:1 port of macOS TrashMeta (FileTrashHandler.swift:123-127).
// On-disk JSON uses snake_case keys (matches macOS JSONEncoder
// .convertToSnakeCase) so trash entries written by either platform can
// be read by the other in a future ops.undo flow.

import { z } from 'zod';

export const TrashMetaSchema = z.object({
  originalPath: z.string().min(1),
  trashedAt: z.number().int().nonnegative(),
  sessionId: z.string().nullable(),
});
export type TrashMeta = z.infer<typeof TrashMetaSchema>;

const TrashMetaWireSchema = z.object({
  original_path: z.string().min(1),
  trashed_at: z.number().int().nonnegative(),
  session_id: z.string().nullable(),
});

export function serializeTrashMeta(meta: TrashMeta): string {
  return JSON.stringify({
    original_path: meta.originalPath,
    trashed_at: meta.trashedAt,
    session_id: meta.sessionId,
  });
}

export function parseTrashMeta(json: string): TrashMeta {
  const raw = JSON.parse(json);
  const wire = TrashMetaWireSchema.parse(raw);
  return {
    originalPath: wire.original_path,
    trashedAt: wire.trashed_at,
    sessionId: wire.session_id,
  };
}
