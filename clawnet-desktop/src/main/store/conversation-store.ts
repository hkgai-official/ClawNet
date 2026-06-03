// @deprecated since P3E. Use SqliteConversationStore. Kept for migration-shim test reference.
import type { Conversation, ChatMessage } from '../../shared/domain/chat';

interface KvLite {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

const CONVERSATIONS_KEY = 'chat.conversations';
const MESSAGES_KEY = 'chat.messages';

export class ConversationStore {
  private conversations: Conversation[];
  private messagesByConv: Record<string, ChatMessage[]>;

  constructor(private readonly kv: KvLite) {
    this.conversations = kv.get<Conversation[]>(CONVERSATIONS_KEY) ?? [];
    this.messagesByConv = kv.get<Record<string, ChatMessage[]>>(MESSAGES_KEY) ?? {};
  }

  listConversations(): Conversation[] {
    return [...this.conversations].sort((a, b) => {
      const ax = a.lastMessageAt ?? a.updatedAt;
      const bx = b.lastMessageAt ?? b.updatedAt;
      return bx.localeCompare(ax);
    });
  }

  getConversation(id: string): Conversation | undefined {
    return this.conversations.find((c) => c.id === id);
  }

  upsertConversation(c: Conversation): void {
    const idx = this.conversations.findIndex((x) => x.id === c.id);
    if (idx >= 0) this.conversations[idx] = c;
    else this.conversations.push(c);
    this.kv.set(CONVERSATIONS_KEY, this.conversations);
  }

  removeConversation(id: string): void {
    this.conversations = this.conversations.filter((c) => c.id !== id);
    delete this.messagesByConv[id];
    this.kv.set(CONVERSATIONS_KEY, this.conversations);
    this.kv.set(MESSAGES_KEY, this.messagesByConv);
  }

  listMessages(conversationId: string): ChatMessage[] {
    return this.messagesByConv[conversationId] ?? [];
  }

  appendMessages(conversationId: string, msgs: ChatMessage[]): void {
    const existing = this.messagesByConv[conversationId] ?? [];
    const ids = new Set(existing.map((m) => m.id));
    const additions = msgs.filter((m) => !ids.has(m.id));
    this.messagesByConv[conversationId] = [...existing, ...additions]
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    this.kv.set(MESSAGES_KEY, this.messagesByConv);
  }

  upsertMessage(m: ChatMessage): void {
    const arr = this.messagesByConv[m.conversationId] ?? [];
    const idx = arr.findIndex((x) => x.id === m.id);
    if (idx >= 0) arr[idx] = m;
    else arr.push(m);
    arr.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    this.messagesByConv[m.conversationId] = arr;
    this.kv.set(MESSAGES_KEY, this.messagesByConv);
  }

  deleteMessage(conversationId: string, id: string): void {
    const arr = this.messagesByConv[conversationId];
    if (!arr) return;
    this.messagesByConv[conversationId] = arr.filter((m) => m.id !== id);
    this.kv.set(MESSAGES_KEY, this.messagesByConv);
  }

  // -- Optimistic-message helpers --
  //
  // Mirrors `ChatEventHandler.addUserMediaMessage` /
  // `updateMessageStatus(tempId:realId:status:)` calls in
  // ChatService.swift:569-607. We don't have a separate event handler in TS;
  // these helpers live on the store so the orchestration code can insert a
  // pending bubble before kicking off the chunked upload, then swap it for
  // the real server message when the round-trip completes (or mark it
  // failed). A temp id is returned so callers can correlate progress events.

  /** Insert a synthetic message keyed by either a caller-provided `tempId`
   *  or a generated `temp-*` id with status='sending'. Returns the id for
   *  later replaceOptimistic / markOptimisticFailed correlation. */
  addOptimisticMessage(
    seed: Omit<ChatMessage, 'id' | 'timestamp' | 'status'>,
    tempId?: string,
  ): string {
    const id = tempId ?? `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const message: ChatMessage = {
      ...seed,
      id,
      timestamp: new Date().toISOString(),
      status: 'sending',
    };
    this.upsertMessage(message);
    return id;
  }

  /** Swap the temp message for the real one once the server has accepted it. */
  replaceOptimistic(tempId: string, real: ChatMessage): void {
    this.deleteMessage(real.conversationId, tempId);
    this.upsertMessage(real);
  }

  /** Mark the temp message as failed (kept visible so the user can retry). */
  markOptimisticFailed(tempId: string): void {
    const found = this.findMessageById(tempId);
    if (!found) return;
    this.upsertMessage({ ...found, status: 'failed' });
  }

  /** Locate a message by id across all conversations. O(N) — used by the
   *  optimistic-flow helpers where the caller only has a temp id. */
  findMessageById(id: string): ChatMessage | undefined {
    for (const arr of Object.values(this.messagesByConv)) {
      const m = arr.find((x) => x.id === id);
      if (m) return m;
    }
    return undefined;
  }
}

// SqliteConversationStore implements this same surface — accept either.
export type ConversationStoreLike = ConversationStore | import('./sqlite-conversation-store').SqliteConversationStore;
