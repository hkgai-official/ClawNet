// src/shared/domain/operation.ts
//
// 1:1 port of macOS OperationLogger.LogEntry / ReverseAction / JSONValue /
// LogFilter / LogQueryResult (OperationLogger.swift:19-54, 206-243).

import { z } from 'zod';

export const JSONValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export type JSONValue = z.infer<typeof JSONValueSchema>;

export const ReverseActionSchema = z.object({
  command: z.string(),
  params: z.record(z.string(), JSONValueSchema),
});

export type ReverseAction = z.infer<typeof ReverseActionSchema>;

export const LogEntrySchema = z.object({
  id: z.string(),
  timestamp: z.number().int(),
  sessionId: z.string().optional(),
  command: z.string(),
  params: z.record(z.string(), JSONValueSchema),
  result: z.enum(['success', 'error', 'partial']),
  errorMessage: z.string().optional(),
  reversible: z.boolean(),
  reverseAction: ReverseActionSchema.optional(),
  type: z.enum(['undo', 'rollback']).optional(),
  undoTargetId: z.string().optional(),
});

export type LogEntry = z.infer<typeof LogEntrySchema>;

export const LogFilterSchema = z.object({
  sessionId: z.string().optional(),
  command: z.string().optional(),
  since: z.number().int().optional(),
  until: z.number().int().optional(),
  limit: z.number().int().min(1).default(50),
  offset: z.number().int().min(0).default(0),
});

export type LogFilter = z.infer<typeof LogFilterSchema>;

export const LogQueryResultSchema = z.object({
  entries: z.array(LogEntrySchema),
  total: z.number().int(),
  hasMore: z.boolean(),
});

export type LogQueryResult = z.infer<typeof LogQueryResultSchema>;

/** Static set: commands that produce log entries (mirrors OperationLogger.loggableCommands). */
export const LOGGABLE_COMMANDS = new Set<string>([
  'file.move', 'file.rename', 'file.copy', 'file.write', 'file.trash', 'file.mkdir',
]);

/** Convert untyped params from JSON.parse into [string -> JSONValue] map. */
export function paramsToJSONValues(params: Record<string, unknown>): Record<string, JSONValue> {
  const out: Record<string, JSONValue> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
      out[k] = v;
    } else {
      out[k] = null;
    }
  }
  return out;
}
