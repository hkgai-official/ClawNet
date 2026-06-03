import { z } from 'zod';
import { defineRequest, defineEvent } from './_common';
import { DialogSessionSchema } from '../domain/dialog';

export const DialogsRequests = {
  /** Approve or deny an A2A dialog authorization request. Sends the
   *  `dialog.intent_authorize` envelope over WS, mirroring macOS
   *  ChatService.swift:1013-1031. */
  'dialogs.intentAuthorize': defineRequest({
    input: z.object({
      authorizationId: z.string(),
      approved: z.boolean(),
    }),
    output: z.void(),
  }),
  'dialogs.create': defineRequest({
    input: z.object({
      initiatorAgentId: z.string(),
      responderAgentId: z.string(),
      topic: z.string().min(1),
      maxRounds: z.number().int().positive().default(5),
    }),
    output: DialogSessionSchema,
  }),
  'dialogs.list': defineRequest({
    input: z.object({ status: z.string().optional() }),
    output: z.array(DialogSessionSchema),
  }),
  'dialogs.getByConv': defineRequest({
    input: z.object({ conversationId: z.string() }),
    output: z.union([DialogSessionSchema, z.null()]),
  }),
  'dialogs.approve': defineRequest({
    input: z.object({
      sessionId: z.string(),
      approved: z.boolean(),
      reason: z.string().optional(),
    }),
    output: z.void(),
  }),
  'dialogs.requestMain': defineRequest({
    input: z.object({ sessionId: z.string() }),
    output: z.void(),
  }),
  'dialogs.refine': defineRequest({
    input: z.object({
      sessionId: z.string(),
      target: z.string(),
      instruction: z.string().min(1),
    }),
    output: z.void(),
  }),
  'dialogs.submitResponse': defineRequest({
    input: z.object({
      sessionId: z.string(),
      text: z.string().min(1),
    }),
    output: z.void(),
  }),
  'dialogs.terminate': defineRequest({
    input: z.object({
      sessionId: z.string(),
      reason: z.string().optional(),
    }),
    output: z.void(),
  }),
  'dialogs.extend': defineRequest({
    input: z.object({
      sessionId: z.string(),
      additionalRounds: z.number().int().positive(),
    }),
    output: z.void(),
  }),
} as const;

// dialog.draft.updated payload — accumulator shape. Matches the post-snake-
// to-camel-converted push from agent-event-bus.ts (which runs deepSnakeToCamel
// because PushDispatcher passes raw snake_case payloads from the gateway).
// The renderer-side dialog-draft-slice keys by sessionId.
const DialogDraftPayloadSchema = z.object({
  sessionId: z.string(),
  mainDraftText: z.string().nullable().optional(),
  secondaryDraftText: z.string().nullable().optional(),
  status: z.enum(['generating', 'ready', 'refining']).nullable().optional(),
}).passthrough();

/**
 * Partial-update payload broadcast for `dialog.status_change`,
 * `dialog.paused`, `dialog.terminated`, `dialog.round_complete` server
 * pushes. The renderer merges these into the cached DialogSession in
 * `dialogs.getByConv` rather than expecting a full session object.
 *
 * Matches macOS AgentService.updateDialogSession parameters.
 */
const DialogStatusChangedPayloadSchema = z.object({
  sessionId: z.string(),
  status: z.string().optional(),
  /**
   * Previous status, when the server includes it. Reliably present on
   * `dialog.status_change` (server `agent_dialog_service.py:692`) but
   * NOT on `dialog.paused` / `dialog.terminated` / `dialog.round_complete`.
   * Lets consumers distinguish "user pressed Terminate while active"
   * (oldStatus=active → terminated) from "responder rejected the
   * approval" (oldStatus=pending_approval → terminated) without
   * scraping the free-form `terminationReason` string.
   */
  oldStatus: z.string().optional(),
  currentRound: z.number().int().nonnegative().optional(),
  maxRounds: z.number().int().nonnegative().optional(),
  terminationReason: z.string().optional(),
}).passthrough();

/**
 * Open A2A draft review panel with the tag (secondary) draft. Companion
 * event to `dialog.draft.updated`.
 */
const DialogPendingReviewPayloadSchema = z.object({
  sessionId: z.string(),
  conversationId: z.string(),
  round: z.number().int().nonnegative(),
  draftText: z.string(),
  agentName: z.string(),
}).passthrough();

/**
 * Push fired when an A2A dialog request is sent to a responder. Consumed
 * by the intent-auth-targets slice (Task 4 useIpcEvent hook) to mark
 * pending approvals against a per-target lifecycle. macOS handles this
 * in ChatService — the payload identifies the session/conversation plus
 * the responder owner + agent. Fields are passthrough so any extra
 * server-side metadata survives validation.
 */
export const DialogRequestSentPayloadSchema = z.object({
  sessionId: z.string(),
  conversationId: z.string(),
  topic: z.string().optional(),
  responderOwner: z.object({
    id: z.string().optional(),
    displayName: z.string().optional(),
  }).passthrough().optional(),
  responderAgent: z.object({
    id: z.string().optional(),
    displayName: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

export const DialogsEvents = {
  'dialog.draft.updated': defineEvent(DialogDraftPayloadSchema),
  'dialog.completed': defineEvent(DialogSessionSchema),
  'dialog.status.changed': defineEvent(DialogStatusChangedPayloadSchema),
  'dialog.pending.review': defineEvent(DialogPendingReviewPayloadSchema),
  'dialog.request.sent': defineEvent(DialogRequestSentPayloadSchema),
} as const;
