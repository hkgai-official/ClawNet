import { z } from 'zod';

// 1:1 port of macOS `DiscoveryTask` from ClawNet/Models/AgentModels.swift:401-419.
// Live-validation deferred: the test account has 0 discovery tasks across all
// statuses and the server exposes no POST endpoint to create one (only
// confirm/cancel of server-side-created tasks). Schema is grep-validated
// against the Swift struct field-by-field — DO NOT re-invent fields without
// reading AgentModels.swift first.
//
// macOS uses `var status: String` (raw string, no enum) — UI checks specific
// status strings ('pending_confirmation', 'confirmed', 'running', etc.) but
// the wire shape isn't enum-validated.

export const DiscoveryTaskSchema = z.object({
  id: z.string(),
  sourceConversationId: z.string(),
  initiatorAgentId: z.string(),
  initiatorOwnerId: z.string(),
  status: z.string(),
  originalIntent: z.string(),
  maxHops: z.number().int().nonnegative(),
  currentHopCount: z.number().int().nonnegative(),
  maxConcurrent: z.number().int().nonnegative(),
  pendingQueries: z.array(z.record(z.unknown())),
  completedResults: z.array(z.record(z.unknown())),
  activeSessions: z.array(z.record(z.unknown())),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable().optional(),
}).passthrough();
export type DiscoveryTask = z.infer<typeof DiscoveryTaskSchema>;
