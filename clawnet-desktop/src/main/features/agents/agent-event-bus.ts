// src/main/features/agents/agent-event-bus.ts
import { z } from 'zod';
import type { PushDispatcher } from '../../network/gateway/push';
import type { IpcEvents } from '../../core/ipc-events';
import { AgentSchema } from '../../../shared/domain/agent';
import { DialogSessionSchema } from '../../../shared/domain/dialog';
import { DiscoveryTaskSchema } from '../../../shared/domain/discovery';
import { ServerTaskSchema, ExecutionLogSchema } from '../../../shared/domain/task';
import { AuditEventSchema } from '../../../shared/domain/audit';
import { FileAccessSettingsSchema } from '../../../shared/domain/file-access';
import { deepSnakeToCamel } from '../../../shared/case-conversion';

const AgentDeletedSchema = z.object({ id: z.string() });

const TaskLogSchema = z.object({
  taskId: z.string(),
  log: ExecutionLogSchema,
});

// dialog.draft.updated push payload — accumulator shape rather than full
// DialogSession (drafts live separately from the session). Wire side is
// snake_case (session_id / main_draft_text / secondary_draft_text /
// status), so we normalize with deepSnakeToCamel before validating +
// broadcasting.
const DialogDraftPushSchema = z.object({
  sessionId: z.string(),
  mainDraftText: z.string().nullable().optional(),
  secondaryDraftText: z.string().nullable().optional(),
  status: z.enum(['generating', 'ready', 'refining']).nullable().optional(),
}).passthrough();

// dialog.status_change / paused / terminated / round_complete share a
// partial-update shape: at minimum sessionId, optionally newStatus +
// round info. macOS unwraps these in handleDialogStatusChange /
// handleDialogPaused / handleDialogTerminated / handleDialogRoundComplete.
// We collapse to one ipc event with the union of fields.
const DialogStatusChangedPushSchema = z.object({
  sessionId: z.string(),
}).passthrough().transform((raw) => {
  const r = raw as Record<string, unknown>;
  const out: {
    sessionId: string;
    status?: string;
    oldStatus?: string;
    currentRound?: number;
    maxRounds?: number;
    terminationReason?: string;
  } = {
    sessionId: r['sessionId'] as string,
  };
  // Server uses snake_case `new_status` on status_change but no field
  // on paused/terminated/round_complete. After deepSnakeToCamel
  // becomes `newStatus`; we normalize to plain `status` for the IPC
  // event.
  const status = r['newStatus'] ?? r['status'];
  if (typeof status === 'string') out.status = status;
  // `old_status` (→ `oldStatus`) is the previous server-side status —
  // present on `dialog.status_change` so a consumer can structurally
  // distinguish "active → terminated" (user-initiated end) from
  // "pending_approval → terminated" (responder rejected the approval)
  // without scraping the free-form `terminationReason` string. The
  // other three topics in this group (paused / terminated /
  // round_complete) don't carry it; consumers treat undefined as "no
  // discriminator available".
  if (typeof r['oldStatus'] === 'string') out.oldStatus = r['oldStatus'];
  if (typeof r['currentRound'] === 'number') out.currentRound = r['currentRound'];
  if (typeof r['maxRounds'] === 'number') out.maxRounds = r['maxRounds'];
  if (typeof r['reason'] === 'string') out.terminationReason = r['reason'];
  return out;
});

const DialogPendingReviewPushSchema = z.object({
  sessionId: z.string(),
  conversationId: z.string(),
  round: z.number().int().nonnegative(),
  draftText: z.string(),
  agentName: z.string(),
}).passthrough();

// dialog.request_sent push: server tells the initiator that a dialog
// request envelope has been delivered to the responder. We forward the
// full (snake→camel) payload as a typed IPC event so the intent-auth-
// targets slice can mark the pending approval; the legacy refresh
// broadcast still fires for useConversations.
const DialogRequestSentPushSchema = z.object({
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

const DialogMainDraftReadyPushSchema = z.object({
  draftText: z.string(),
  sessionId: z.string().optional(),
}).passthrough();

const ConversationUpdatedPushSchema = z.object({
  conversationId: z.string(),
  summary: z.string(),
}).passthrough();

const GroupMembersChangedPushSchema = z.object({
  conversationId: z.string(),
  action: z.enum(['added', 'removed']),
  members: z.array(z.record(z.unknown())).default([]),
}).passthrough();

export interface AgentEventBusOptions {
  dispatcher: PushDispatcher;
  events: IpcEvents;
}

function relay<T>(
  dispatcher: PushDispatcher,
  topic: string,
  schema: z.ZodType<T>,
  ipcChannel: string,
  events: IpcEvents,
): void {
  dispatcher.subscribe(topic, (payload) => {
    const result = schema.safeParse(payload);
    if (!result.success) return;
    events.broadcast(ipcChannel, result.data);
  });
}

export class AgentEventBus {
  constructor(opts: AgentEventBusOptions) {
    const { dispatcher, events } = opts;

    relay(dispatcher, 'agent.updated', AgentSchema, 'agent.updated', events);
    relay(dispatcher, 'agent.deleted', AgentDeletedSchema, 'agent.deleted', events);

    // Server emits `dialog.draft_updated` with an UNDERSCORE between
    // "draft" and "updated" (macOS ChatService.swift:193). An earlier
    // version of this code subscribed to `dialog.draft.updated` (DOT),
    // which never fired against a real server — A2A drafts only
    // refreshed via REST polling. The IPC event toward the renderer
    // keeps the DOT name (`dialog.draft.updated`) since the renderer
    // subscriber and IPC contract have always used that form; only the
    // server-side topic name needed correction.
    dispatcher.subscribe('dialog.draft_updated', (payload) => {
      const normalized = deepSnakeToCamel(payload) as Record<string, unknown>;
      // Server wire shape for refine-triggered updates carries
      // `{session_id, target: 'tag'|'main', draft_text}` — i.e. a
      // single draft keyed by target. macOS handleDraftUpdated
      // (ChatService.swift:1182-1193) routes by target. Mirror that:
      // translate to the slot the renderer expects (`secondaryDraftText`
      // for tag, `mainDraftText` for main).
      const target = normalized['target'];
      const draftText = normalized['draftText'];
      if (typeof target === 'string' && typeof draftText === 'string') {
        const sessionId = normalized['sessionId'];
        if (typeof sessionId !== 'string') return;
        const payload =
          target === 'tag'
            ? { sessionId, secondaryDraftText: draftText, status: 'ready' as const }
            : target === 'main'
              ? { sessionId, mainDraftText: draftText, status: 'ready' as const }
              : null;
        if (payload) events.broadcast('dialog.draft.updated', payload);
        return;
      }
      // Fallback: server may also push accumulator-style payloads
      // (already-keyed `secondaryDraftText`/`mainDraftText`). Validate
      // and forward as-is.
      const parsed = DialogDraftPushSchema.safeParse(normalized);
      if (!parsed.success) return;
      events.broadcast('dialog.draft.updated', parsed.data);
    });

    relay(dispatcher, 'dialog.completed', DialogSessionSchema, 'dialog.completed', events);

    // Group of A2A lifecycle pushes that all carry a partial-update on
    // the dialog session (sessionId + maybe status / round info). macOS
    // routes each via `agentService.updateDialogSession(...)`. We
    // broadcast a single `dialog.status.changed` IPC event with the
    // partial payload and let the renderer's react-query merge it.
    for (const topic of [
      'dialog.status_change',
      'dialog.paused',
      'dialog.terminated',
      'dialog.round_complete',
    ] as const) {
      dispatcher.subscribe(topic, (payload) => {
        const normalized = deepSnakeToCamel(payload);
        const parsed = DialogStatusChangedPushSchema.safeParse(normalized);
        if (!parsed.success) return;
        // dialog.terminated always implies status='terminated'; macOS
        // hard-codes this in handleDialogTerminated even when the wire
        // payload omits it. Mirror that.
        const data = topic === 'dialog.terminated' && !parsed.data.status
          ? { ...parsed.data, status: 'terminated' }
          : parsed.data;
        events.broadcast('dialog.status.changed', data);
      });
    }

    // dialog.pending_review opens the A2A draft review panel with the
    // tag (secondary) draft. macOS ChatService.handlePendingReview
    // (ChatService.swift:1159). We broadcast both:
    //   - `dialog.pending.review` for the review panel state machine
    //   - `dialog.draft.updated` so the draft slice gets the tag side
    dispatcher.subscribe('dialog.pending_review', (payload) => {
      const normalized = deepSnakeToCamel(payload);
      const parsed = DialogPendingReviewPushSchema.safeParse(normalized);
      if (!parsed.success) return;
      events.broadcast('dialog.pending.review', parsed.data);
      events.broadcast('dialog.draft.updated', {
        sessionId: parsed.data.sessionId,
        secondaryDraftText: parsed.data.draftText,
        status: 'ready',
      });
    });

    // dialog.main_draft_ready updates the main (initiator-side) draft.
    // The wire payload doesn't include session_id — macOS just updates
    // whatever review is currently open. We need to look up the active
    // session: fold this into a draft.updated event keyed by sessionId
    // if the server sends it; otherwise log and skip.
    dispatcher.subscribe('dialog.main_draft_ready', (payload) => {
      const normalized = deepSnakeToCamel(payload);
      const parsed = DialogMainDraftReadyPushSchema.safeParse(normalized);
      if (!parsed.success) return;
      if (!parsed.data.sessionId) {
        // No session id — renderer's review panel knows its own session;
        // broadcast without sessionId. The draft slice's updateDraft
        // requires sessionId so we can't route through it directly;
        // a future improvement would track the active review in main.
        return;
      }
      events.broadcast('dialog.draft.updated', {
        sessionId: parsed.data.sessionId,
        mainDraftText: parsed.data.draftText,
        status: 'ready',
      });
    });

    relay(dispatcher, 'discovery.statusChanged', DiscoveryTaskSchema, 'discovery.statusChanged', events);
    relay(dispatcher, 'task.statusChanged', ServerTaskSchema, 'task.statusChanged', events);
    relay(dispatcher, 'task.log.appended', TaskLogSchema, 'task.log.appended', events);

    // Audit events. macOS subscribes to specific topics
    // (audit.access_denied / audit.boundary_violation / approval.requested)
    // and funnels each through AuditService.handleAuditEvent. The Win
    // port's pre-existing `audit.event` relay was likely dead code (no
    // evidence the real server emits that aggregated topic). We keep
    // the legacy relay for backward compat with the existing fake-server
    // test (15-security-event-center.spec) AND subscribe to the actual
    // server topics, mapping each through to the same `audit.event` IPC
    // channel the renderer already listens to.
    relay(dispatcher, 'audit.event', AuditEventSchema, 'audit.event', events);
    for (const topic of ['audit.access_denied', 'audit.boundary_violation', 'approval.requested'] as const) {
      dispatcher.subscribe(topic, (payload) => {
        // These push payloads usually arrive in AuditEvent shape; if
        // not, synthesize a minimal one so the renderer's audit list
        // can still render.
        const result = AuditEventSchema.safeParse(payload);
        if (result.success) {
          events.broadcast('audit.event', result.data);
          return;
        }
        // Fallback: build a minimal AuditEvent from whatever fields are
        // present. The wire payload from the server's audit pipeline
        // includes `id` + `timestamp` even when other fields vary.
        const p = (payload ?? {}) as Record<string, unknown>;
        events.broadcast('audit.event', AuditEventSchema.parse({
          id: typeof p['id'] === 'string' ? p['id'] : `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          eventType: topic,
          ...(typeof p['agent_id'] === 'string' ? { agentId: p['agent_id'] } : {}),
          ...(typeof p['agent_name'] === 'string' ? { agentName: p['agent_name'] } : {}),
          ...(typeof p['tag_role'] === 'string' ? { tagRole: p['tag_role'] } : {}),
          details: typeof p['details'] === 'object' && p['details'] !== null
            ? Object.fromEntries(
                Object.entries(p['details'] as Record<string, unknown>)
                  .filter(([, v]) => typeof v === 'string') as Array<[string, string]>,
              )
            : {},
          timestamp: typeof p['timestamp'] === 'string' ? p['timestamp'] : new Date().toISOString(),
        }));
      });
    }

    relay(dispatcher, 'file_access.changed', FileAccessSettingsSchema, 'fileAccess.changed', events);

    // ── Friend-request notifications ──
    // macOS just refreshes the contacts/friend-request list. We
    // broadcast the events; the renderer's react-query invalidates.
    dispatcher.subscribe('friend_request.new', (payload) => {
      const normalized = deepSnakeToCamel(payload);
      events.broadcast('friend_request.new', normalized);
    });
    dispatcher.subscribe('friend_request.accepted', (payload) => {
      const normalized = deepSnakeToCamel(payload);
      events.broadcast('friend_request.accepted', normalized);
    });

    // ── Conversation / group state ──
    // macOS handleConversationUpdated patches the summary in-place;
    // handleGroupMembersChanged adds/removes participants. We forward
    // both as IPC events for the renderer's react-query to merge.
    dispatcher.subscribe('conversation.updated', (payload) => {
      const normalized = deepSnakeToCamel(payload);
      const parsed = ConversationUpdatedPushSchema.safeParse(normalized);
      if (!parsed.success) return;
      events.broadcast('conversation.updated', parsed.data);
    });
    dispatcher.subscribe('group.members_changed', (payload) => {
      const normalized = deepSnakeToCamel(payload);
      const parsed = GroupMembersChangedPushSchema.safeParse(normalized);
      if (!parsed.success) return;
      events.broadcast('group.members.changed', parsed.data);
    });

    // dialog.approval_request still just refreshes the conversation list
    // (consumed by useConversations).
    dispatcher.subscribe('dialog.approval_request', () => {
      events.broadcast('chat.conversations.refresh', { cause: 'dialog.approval_request' });
    });

    // dialog.request_sent: keep the conversation-list refresh AND forward
    // the full payload as a typed IPC event for the intent-auth-targets
    // slice. macOS-equivalent: the initiator-side handler that records
    // per-target pending approvals.
    dispatcher.subscribe('dialog.request_sent', (payload) => {
      const normalized = deepSnakeToCamel(payload);
      const parsed = DialogRequestSentPushSchema.safeParse(normalized);
      if (parsed.success) {
        events.broadcast('dialog.request.sent', parsed.data);
      }
      events.broadcast('chat.conversations.refresh', { cause: 'dialog.request_sent' });
    });
  }
}
