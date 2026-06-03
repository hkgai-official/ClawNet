import { z } from 'zod';

/**
 * Typed CardData schemas for rich-card variants on top of `MessageContent`.
 *
 * Each schema validates the `MessageContent.rawData` payload AFTER:
 *  - HttpClient's `deepSnakeToCamel` runs on REST responses, AND
 *  - The WS push-path normalizer in `chat-event-handler.ts` applies the same
 *    transform on `chat.message.created` payloads (see Task 3).
 *
 * Source-of-truth Swift files cited per schema. All schemas use `.passthrough()`
 * so any additional server-supplied fields (e.g. timestamps, ids) survive parse.
 */

// --- TaskProgress (mirrors macOS TaskProgress, AgentModels.swift:352-358) ---
// macOS reads `progress` as Int 0..100 then divides by 100 (MessageBubble.swift:309).
// To stay forgiving, accept either an int 0..100 OR a float 0..1; normalize to 0..1.
export const TaskProgressCardDataSchema = z
  .object({
    taskId: z.string(),
    stage: z.string(),
    progress: z.number().transform((v) => (v > 1 ? v / 100 : v)),
    details: z.record(z.string()).nullable().optional(),
  })
  .passthrough();
export type TaskProgressCardData = z.infer<typeof TaskProgressCardDataSchema>;

// --- TaskResult (AgentModels.swift:359-370) ---
const TaskResultDetailsSchema = z
  .object({
    filesProcessed: z.number().int().nullable().optional(),
    logs: z.array(z.string()).nullable().optional(),
  })
  .passthrough();
export const TaskResultCardDataSchema = z
  .object({
    taskId: z.string(),
    success: z.boolean(),
    summary: z.string(),
    error: z.string().nullable().optional(),
    details: TaskResultDetailsSchema.nullable().optional(),
  })
  .passthrough();
export type TaskResultCardData = z.infer<typeof TaskResultCardDataSchema>;

// --- Reusable refs for dialog/intent cards ---
const AgentRefSchema = z.object({ displayName: z.string() }).passthrough();
const TagRefSchema = z.object({ displayName: z.string() }).passthrough();
const OwnerRefSchema = z
  .object({ id: z.string(), displayName: z.string().optional() })
  .passthrough();

// --- DialogRequest (RichCardViews.swift:186-196 + MessageBubble.swift:230-242) ---
export const DialogRequestCardDataSchema = z
  .object({
    topic: z.string().optional(),
    status: z.string(),
    myAgent: AgentRefSchema.optional(),
    targetAgent: AgentRefSchema.optional(),
    contactTag: TagRefSchema.nullable().optional(),
    targetOwner: OwnerRefSchema.optional(),
  })
  .passthrough();
export type DialogRequestCardData = z.infer<typeof DialogRequestCardDataSchema>;

// --- DialogApproval (RichCardViews.swift:293-307 + MessageBubble.swift:245-262) ---
export const DialogApprovalCardDataSchema = z
  .object({
    topic: z.string().optional(),
    status: z.string(),
    initiatorAgent: AgentRefSchema.optional(),
    initiatorOwner: OwnerRefSchema.optional(),
    myAgent: AgentRefSchema.optional(),
    contactTag: TagRefSchema.nullable().optional(),
    sessionId: z.string().optional(),
  })
  .passthrough();
export type DialogApprovalCardData = z.infer<typeof DialogApprovalCardDataSchema>;

// --- IntentAuthorization (RichCardViews.swift:408-415, 469-471) ---
// NOTE: macOS reads `target_user_name`, `contact_tag_display_name`, `topic`
// directly in snake_case from `targets[]` items (RichCardViews.swift:469,471).
// The WS normalizer (Task 3) is configured with `skipKeys: ['targets']` so
// these inner keys stay snake_case. We mirror that here.
const IntentTargetSchema = z
  .object({
    target_user_name: z.string().optional(),
    target_agent_name: z.string().optional(),   // server emits this; previously dropped from typing
    contact_tag_name: z.string().optional(),    // server emits this too
    contact_tag_display_name: z.string().optional(),
    topic: z.string().optional(),
  })
  .passthrough();
export const IntentAuthorizationCardDataSchema = z
  .object({
    cardType: z.literal('intent_authorization'),
    authorizationId: z.string(),
    agentName: z.string().optional(),
    status: z.string(),
    isMainAgent: z.boolean().optional(),
    targets: z.array(IntentTargetSchema),
  })
  .passthrough();
export type IntentAuthorizationCardData = z.infer<typeof IntentAuthorizationCardDataSchema>;
