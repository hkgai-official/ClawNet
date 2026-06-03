import type { PushDispatcher } from '../../network/gateway/push';
import type { ConversationStoreLike } from '../../store/conversation-store';
import { ChatMessageSchema, ParticipantSchema, type ChatMessage, type Participant } from '../../../shared/domain/chat';
import { deepSnakeToCamel } from '../../../shared/case-conversion';
import { z } from 'zod';

// Keep `targets[]` items inside intent_authorization rawData snake_case to
// mirror macOS RichCardViews.swift:469,471 (`target_user_name`,
// `contact_tag_display_name` are read snake-cased from the dict directly).
const NORMALIZE_OPTS = { skipKeys: ['targets'] };

// Server-proxied flow uses `message_id` as the stream key, not `run_id`.
// macOS ChatService still calls it run_id internally; we adopt server's
// field name and rename in tests + downstream callers.
const StreamStartPayloadSchema = z.object({
  message_id: z.string(),
  conversation_id: z.string(),
  sender: ParticipantSchema,
}).passthrough();

const StreamDeltaPayloadSchema = z.object({
  message_id: z.string(),
  delta: z.string(),
}).passthrough();

const StreamEndPayloadSchema = z.object({
  message_id: z.string(),
  final_text: z.string().optional(),
}).passthrough();

const StreamCancelledPayloadSchema = z.object({
  message_id: z.string(),
}).passthrough();

/**
 * `dialog.intent_authorization` push payload (snake_case from server).
 * Inner `targets[]` items are intentionally kept as a free-shape record
 * — the renderer reads `target_user_name`, `contact_tag_display_name`,
 * `topic` in snake_case to mirror macOS RichCardViews.swift:469,471.
 */
const IntentAuthorizationPushSchema = z.object({
  authorization_id: z.string(),
  agent_name: z.string().optional(),
  conversation_id: z.string(),
  is_main_agent: z.boolean().optional(),
  targets: z.array(z.record(z.unknown())).default([]),
}).passthrough();

interface PlaybackEngineLike {
  start(runId: string, init: { conversationId: string; sender: Participant }): void;
  appendDelta(runId: string, delta: string): void;
  markComplete(runId: string, finalText?: string): void;
  cancel(runId: string): void;
}

/** Minimal surface needed for desktop notifications. Matches the public
 *  signature of `NotificationService.showMessageNotification`. */
export interface ChatNotifier {
  showMessageNotification(senderName: string, body: string, conversationId: string): void;
}

export interface ChatEventHandlerOptions {
  store: ConversationStoreLike;
  dispatcher: PushDispatcher;
  engine: PlaybackEngineLike;
  onCreated: (m: ChatMessage) => void;
  /** Optional desktop notifier. When provided, incoming messages from
   *  other senders trigger a `Notification` while the main window is
   *  unfocused. Skipping it altogether (legacy / tests) just renders
   *  the message without an OS notification. */
  notifier?: ChatNotifier;
  /** Returns the current logged-in user's id so we can skip notifying
   *  the user about their own sent-back-from-server messages. Returns
   *  `null` while logged-out (in which case no message should arrive
   *  anyway, but we keep the guard defensive). */
  getCurrentUserId?: () => string | null;
  /** Returns true when at least one app window currently has OS focus.
   *  We suppress notifications in that case — the user already sees the
   *  message inline. macOS NotificationService.swift uses NSApp's active
   *  state for the same purpose. */
  isAppFocused?: () => boolean;
}

/**
 * One-line preview for a notification body. macOS uses the message
 * `text` when available, otherwise a localized "[image]" / "[file]"
 * etc. placeholder. Here we keep it ASCII so the i18n stays renderer-
 * side; the main process doesn't have i18next loaded.
 */
function previewBodyForNotification(m: ChatMessage): string {
  const c = m.content as { text?: string | null; name?: string | null } | null;
  const text = c?.text?.trim();
  if (text) return text.length > 120 ? text.slice(0, 117) + '…' : text;
  switch (m.contentType) {
    case 'image': return '[image]';
    case 'video': return '[video]';
    case 'voice': return '[voice]';
    case 'file':  return c?.name ? `[file] ${c.name}` : '[file]';
    case 'rich_card': return '[card]';
    default: return '[message]';
  }
}

export class ChatEventHandler {
  constructor(private readonly opts: ChatEventHandlerOptions) {
    // Server-proxied flow event types (see macOS ChatService.swift's giant
    // type switch). `message.new` carries a full ChatMessage payload;
    // `message.sent` is just an ack `{messageId, timestamp}` confirming the
    // user's send (used to flip optimistic temp ids to real ids — handled
    // separately, not via handleCreated which expects a full message).
    opts.dispatcher.subscribe('message.new', (p) => this.handleCreated(p));
    opts.dispatcher.subscribe('message.sent', (p) => this.handleSentAck(p));
    opts.dispatcher.subscribe('message.stream_start', (p) => this.handleStreamStart(p));
    opts.dispatcher.subscribe('message.stream_delta', (p) => this.handleStreamDelta(p));
    opts.dispatcher.subscribe('message.stream_end', (p) => this.handleStreamEnd(p));
    opts.dispatcher.subscribe('message.stop', (p) => this.handleStreamCancelled(p));
    // Server pushes `dialog.intent_authorization` as a standalone event,
    // NOT as a chat message. macOS ChatService.swift:692-729 synthesizes
    // a system rich_card and injects it into the conversation so the
    // user sees the IntentAuthorizationCard. We mirror that here.
    opts.dispatcher.subscribe('dialog.intent_authorization', (p) =>
      this.handleIntentAuthorizationPush(p),
    );
    // `dialog.main_agent_blocked` — the user asked the Main Assistant to
    // contact someone, but main agents can't initiate A2A. macOS shows
    // a text system message explaining; we do the same.
    opts.dispatcher.subscribe('dialog.main_agent_blocked', (p) =>
      this.handleMainAgentBlockedPush(p),
    );
    // `audit.intent_denied` — server reports that an attempted A2A
    // intent was denied (timeout, target offline, refused, etc.).
    // macOS doesn't surface this to the user; Win shows a text system
    // message so the user knows why their "联系下 X" yielded no card.
    // Captured live from prod (40-prod-intent-auth-probe.spec).
    opts.dispatcher.subscribe('audit.intent_denied', (p) =>
      this.handleIntentDeniedPush(p),
    );
  }

  private handleCreated(payload: unknown): void {
    const normalized = deepSnakeToCamel(payload, NORMALIZE_OPTS);
    const parsed = ChatMessageSchema.safeParse(normalized);
    if (!parsed.success) {
      console.warn('[ChatEventHandler] chat.message.created schema parse failed', parsed.error.issues.slice(0, 3), 'payload:', JSON.stringify(normalized).slice(0, 400));
      return;
    }
    this.opts.store.upsertMessage(parsed.data);
    this.opts.onCreated(parsed.data);
    this.maybeNotify(parsed.data);
  }

  /**
   * Fire a desktop notification for an incoming message, unless:
   *   1. No notifier is wired (tests / pre-P3D code paths).
   *   2. The message is from a non-human sender — agent / system traffic
   *      (A2A dialog protocol messages, agent replies) is not a "someone
   *      messaged you" event and must not pop a notification.
   *   3. The message is from the current user (their own send echoing back).
   *   4. The app already has OS focus — the user is looking at it.
   * Mirrors macOS NotificationService.swift behaviour where notifications
   * suppress while the app is active.
   */
  private maybeNotify(m: ChatMessage): void {
    const notifier = this.opts.notifier;
    if (!notifier) return;
    if (m.sender.type !== 'human') return;
    const me = this.opts.getCurrentUserId?.();
    if (me && m.sender.id === me) return;
    if (this.opts.isAppFocused?.()) return;
    const body = previewBodyForNotification(m);
    notifier.showMessageNotification(m.sender.name, body, m.conversationId);
  }

  private handleStreamStart(payload: unknown): void {
    const parsed = StreamStartPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.warn('[ChatEventHandler] message.stream_start schema parse failed', parsed.error.issues.slice(0, 3), 'payload:', JSON.stringify(payload).slice(0, 400));
      return;
    }
    // Insert a placeholder bubble so the MessageList renders the agent's
    // streaming output as it arrives. Subsequent stream_delta events flow
    // through useStream() in MessageBubble; stream_end (or a follow-up
    // message.new push) replaces the placeholder with the final record.
    const placeholder = {
      id: parsed.data.message_id,
      conversationId: parsed.data.conversation_id,
      sender: parsed.data.sender,
      contentType: 'text' as const,
      content: { text: '' },
      timestamp: new Date().toISOString(),
      status: 'sending' as const,
    };
    this.opts.store.upsertMessage(placeholder);
    this.opts.onCreated(placeholder);
    this.opts.engine.start(parsed.data.message_id, {
      conversationId: parsed.data.conversation_id,
      sender: parsed.data.sender,
    });
  }

  private handleStreamDelta(payload: unknown): void {
    const parsed = StreamDeltaPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.warn('[ChatEventHandler] message.stream_delta schema parse failed', parsed.error.issues.slice(0, 3));
      return;
    }
    this.opts.engine.appendDelta(parsed.data.message_id, parsed.data.delta);
  }

  private handleStreamEnd(payload: unknown): void {
    const parsed = StreamEndPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.warn('[ChatEventHandler] message.stream_end schema parse failed', parsed.error.issues.slice(0, 3));
      return;
    }
    this.opts.engine.markComplete(parsed.data.message_id, parsed.data.final_text);
  }

  private handleStreamCancelled(payload: unknown): void {
    const parsed = StreamCancelledPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.warn('[ChatEventHandler] message.stop schema parse failed', parsed.error.issues.slice(0, 3));
      return;
    }
    this.opts.engine.cancel(parsed.data.message_id);
  }

  /** message.sent is a server ack `{message_id, timestamp}` for our send.
   *  Used to confirm the optimistic message reached the DB. We don't have
   *  enough fields here to build a full ChatMessage, so just log it for
   *  now; future work: swap the optimistic temp id for the real one. */
  private handleSentAck(payload: unknown): void {
    const ackShape = z.object({ message_id: z.string(), timestamp: z.string() }).passthrough();
    const parsed = ackShape.safeParse(payload);
    if (!parsed.success) {
      console.warn('[ChatEventHandler] message.sent ack schema parse failed', parsed.error.issues.slice(0, 3));
      return;
    }
    // Intentionally a no-op (for now) — server will emit a follow-up
    // message.new with the full record once the conversation flows.
    void parsed.data.message_id;
  }

  /**
   * Synthesize a system rich_card from a `dialog.intent_authorization`
   * push and inject it into the conversation so MessageBubble renders
   * the IntentAuthorizationCard. 1:1 port of macOS
   * ChatService.swift:692-729 (handleDialogIntentAuthorization).
   *
   * Wire shape (snake_case from server):
   *   { authorization_id, agent_name, conversation_id, is_main_agent?,
   *     targets: [{ target_user_name, contact_tag_display_name, topic, ... }] }
   *
   * Note: `targets[]` inner keys are KEPT snake_case here. The renderer
   * (IntentAuthorizationCard) reads them as snake to mirror macOS
   * RichCardViews.swift:469,471. The deepSnakeToCamel pass elsewhere
   * uses `skipKeys: ['targets']` for the same reason.
   */
  private handleIntentAuthorizationPush(payload: unknown): void {
    const parsed = IntentAuthorizationPushSchema.safeParse(payload);
    if (!parsed.success) {
      console.warn(
        '[ChatEventHandler] dialog.intent_authorization parse failed',
        parsed.error.issues.slice(0, 3),
        'payload:',
        JSON.stringify(payload).slice(0, 400),
      );
      return;
    }
    const {
      authorization_id: authorizationId,
      agent_name: agentName,
      conversation_id: conversationId,
      is_main_agent: isMainAgent,
      targets,
    } = parsed.data;

    // Idempotency: a deterministic id keyed off the authorization id so
    // duplicate pushes upsert into the same row rather than spamming the
    // conversation. Matches macOS's `intent-auth-<authId>` pattern.
    const synthetic: ChatMessage = {
      id: `intent-auth-${authorizationId}`,
      conversationId,
      sender: { id: 'system', name: '系统', type: 'system' },
      contentType: 'rich_card',
      content: {
        cardType: 'intent_authorization',
        authorizationId,
        status: 'pending',
        targets,
        ...(agentName !== undefined ? { agentName } : {}),
        ...(isMainAgent !== undefined ? { isMainAgent } : {}),
      } as ChatMessage['content'],
      timestamp: new Date().toISOString(),
      status: 'sent',
    };

    this.opts.store.upsertMessage(synthetic);
    this.opts.onCreated(synthetic);
  }

  /**
   * `audit.intent_denied` — surface why an A2A intent didn't reach the
   * intent_authorization stage. The push carries `{agent_name, targets,
   * reason}`; we synthesize a text system message so the user can see
   * "Default tried to contact bob but timed out" instead of silence.
   *
   * No conversation_id on the wire — broadcast to the active conv if
   * known; otherwise drop silently (the audit event center has its own
   * record via the audit.* subscribers in agent-event-bus).
   */
  private handleIntentDeniedPush(payload: unknown): void {
    const parsed = z.object({
      agent_name: z.string().optional(),
      targets: z.array(z.union([z.string(), z.record(z.unknown())])).optional(),
      reason: z.string().optional(),
      conversation_id: z.string().optional(),
    }).passthrough().safeParse(payload);
    if (!parsed.success) return;
    const convId = parsed.data.conversation_id;
    if (!convId) return; // Without a conv id we can't anchor a system message.
    const targets = (parsed.data.targets ?? [])
      .map((t) => (typeof t === 'string' ? t : (t['target_user_name'] as string) ?? ''))
      .filter((s) => s.length > 0)
      .join(', ');
    const agent = parsed.data.agent_name ?? 'Agent';
    const reason = parsed.data.reason ?? 'unknown';
    const text = targets
      ? `${agent} 想联系 ${targets},但被拒绝(原因:${reason})。`
      : `${agent} 的联系请求被拒绝(原因:${reason})。`;
    const synthetic: ChatMessage = {
      id: `intent-denied-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId: convId,
      sender: { id: 'system', name: '系统', type: 'system' },
      contentType: 'text',
      content: { text } as ChatMessage['content'],
      timestamp: new Date().toISOString(),
      status: 'sent',
    };
    this.opts.store.upsertMessage(synthetic);
    this.opts.onCreated(synthetic);
  }

  /**
   * Synthesize a text system message for `dialog.main_agent_blocked`.
   * 1:1 port of macOS ChatService.swift:731-747. Fallback message
   * matches macOS's hard-coded zh string when wire payload omits it.
   */
  private handleMainAgentBlockedPush(payload: unknown): void {
    const parsed = z.object({
      conversation_id: z.string(),
      message: z.string().optional(),
    }).passthrough().safeParse(payload);
    if (!parsed.success) {
      console.warn(
        '[ChatEventHandler] dialog.main_agent_blocked parse failed',
        parsed.error.issues.slice(0, 3),
      );
      return;
    }
    const text = parsed.data.message ?? 'Main Assistant 不能直接联系其他人。';
    // UUID-style suffix so repeated blocks each get their own message
    // (no dedup like intent-auth).
    const id = `main-blocked-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const synthetic: ChatMessage = {
      id,
      conversationId: parsed.data.conversation_id,
      sender: { id: 'system', name: '系统', type: 'system' },
      contentType: 'text',
      content: { text } as ChatMessage['content'],
      timestamp: new Date().toISOString(),
      status: 'sent',
    };
    this.opts.store.upsertMessage(synthetic);
    this.opts.onCreated(synthetic);
  }
}
