import { z } from 'zod';

// 1:1 port of macOS `DialogSession` from ClawNet/Models/AgentModels.swift:289-348.
// Cross-validated against the live server payload at
// http://localhost:9000/api/v1/agent-dialogs (commit "fix(domain):
// canonical governance schemas").
//
// DO NOT add or rename fields without first checking AgentModels.swift —
// previous iterations of this file invented `initiator`/`responder`/`user`
// /`draftMain`/`draftSecondary`/`finalResponse` from imagination and the
// UI built on top of them silently failed to parse real server responses.

// macOS enum DialogStatus (5 values, raw-string Codable).
export const DialogStatusSchema = z.enum([
  'pending_approval',
  'active',
  'paused',
  'completed',
  'terminated',
]);
export type DialogStatus = z.infer<typeof DialogStatusSchema>;

// macOS DialogAgentInfo: id, displayName, avatarUrl?, status?.
export const DialogAgentInfoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
}).passthrough();
export type DialogAgentInfo = z.infer<typeof DialogAgentInfoSchema>;

// macOS DialogUserInfo: id, displayName, avatarUrl?.
export const DialogUserInfoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable().optional(),
}).passthrough();
export type DialogUserInfo = z.infer<typeof DialogUserInfoSchema>;

export const DialogSessionSchema = z.object({
  id: z.string(),
  initiatorAgent: DialogAgentInfoSchema,
  responderAgent: DialogAgentInfoSchema,
  initiatorOwner: DialogUserInfoSchema,
  responderOwner: DialogUserInfoSchema,
  topic: z.string(),
  status: DialogStatusSchema,
  currentRound: z.number().int().nonnegative(),
  maxRounds: z.number().int().positive(),
  conversationId: z.string().nullable().optional(),
  createdAt: z.string(),
  startedAt: z.string().nullable().optional(),
  lastMessageAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  terminationReason: z.string().nullable().optional(),
  // Wire fields the server returns but the macOS canonical struct doesn't
  // decode. Kept here as optional so .passthrough() doesn't have to swallow
  // them silently — explicit > implicit:
  initiatorApproved: z.boolean().optional(),
  responderApproved: z.boolean().optional(),
  idleTimeoutSeconds: z.number().optional(),
}).passthrough();
export type DialogSession = z.infer<typeof DialogSessionSchema>;
