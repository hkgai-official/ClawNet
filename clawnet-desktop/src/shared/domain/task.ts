import { z } from 'zod';

// 1:1 port of macOS `ServerTask` + `ExecutionLog` + `ApprovalDecision` from
// ClawNet/Models/AgentModels.swift:387-436.
//
// Notes:
//  - macOS uses `var status: String` and `var priority: String` (raw strings,
//    no enum). The previous iteration of this file invented enums (`TaskStatus`,
//    `TaskPriority`) — removed because they don't reflect server reality.
//  - `executionPlan` / `result` are `[String: AnyCodable]?` in macOS — opaque
//    server-controlled maps. Modeled as `z.record(z.unknown())`.
//  - The old `TaskProgressSchema` and `progress` field on ServerTask were
//    invented (not in macOS). Removed.

export const ServerTaskSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  conversationId: z.string(),
  description: z.string().nullable().optional(),
  status: z.string(),
  executionPlan: z.record(z.unknown()).nullable().optional(),
  result: z.record(z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  priority: z.string(),
  createdAt: z.string(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
}).passthrough();
export type ServerTask = z.infer<typeof ServerTaskSchema>;

// Request body for POST /api/v1/tasks/:id/approve. Mirrors the macOS app's
// confirm/cancel/modify decision contract.
export const ApprovalDecisionSchema = z.enum(['approve', 'reject', 'modify']);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ApprovalRequestSchema = z.object({
  decision: ApprovalDecisionSchema,
  modifications: z.string().optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

// 1:1 port of macOS `ExecutionLog` (AgentModels.swift:387-398). The macOS
// struct uses `timestamp: Double` (epoch seconds), `step: String`,
// `message: String`, `level: LogLevel? (info|warning|error|debug)`,
// `details: [String: String]?`. No `id` or `taskId` fields — the macOS code
// computes `id` from `"\(timestamp)-\(step)"`.
export const ExecutionLogLevelSchema = z.enum(['info', 'warning', 'error', 'debug']);
export type ExecutionLogLevel = z.infer<typeof ExecutionLogLevelSchema>;

export const ExecutionLogSchema = z.object({
  timestamp: z.number(),
  step: z.string(),
  message: z.string(),
  level: ExecutionLogLevelSchema.nullable().optional(),
  details: z.record(z.string()).nullable().optional(),
}).passthrough();
export type ExecutionLog = z.infer<typeof ExecutionLogSchema>;
