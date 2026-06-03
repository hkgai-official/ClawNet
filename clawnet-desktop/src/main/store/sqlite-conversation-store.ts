// src/main/store/sqlite-conversation-store.ts
//
// Drop-in replacement for ConversationStore backed by SQLite. Public API
// matches the legacy class so callers (ChatService, ChatEventHandler) work
// unchanged.

import type Database from 'better-sqlite3';
import type {
  Conversation,
  ChatMessage,
  Participant,
  MessageContent,
  MessageContentType,
  MessageStatus,
} from '../../shared/domain/chat';

interface ConversationRow {
  id: string;
  type: string;
  title: string | null;
  participantsJson: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
  summary: string | null;
}

interface MessageRow {
  id: string;
  conversationId: string;
  senderJson: string;
  contentType: string;
  contentJson: string;
  timestamp: string;
  status: string | null;
}

function rowToConversation(r: ConversationRow): Conversation {
  const c: Conversation = {
    id: r.id,
    type: r.type as Conversation['type'],
    participants: JSON.parse(r.participantsJson) as Participant[],
    unreadCount: r.unreadCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
  if (r.title !== null) c.title = r.title;
  if (r.summary !== null) c.summary = r.summary;
  if (r.lastMessagePreview !== null) c.lastMessagePreview = r.lastMessagePreview;
  if (r.lastMessageAt !== null) c.lastMessageAt = r.lastMessageAt;
  return c;
}

function rowToMessage(r: MessageRow): ChatMessage {
  const m: ChatMessage = {
    id: r.id,
    conversationId: r.conversationId,
    sender: JSON.parse(r.senderJson) as Participant,
    contentType: r.contentType as MessageContentType,
    content: JSON.parse(r.contentJson) as MessageContent,
    timestamp: r.timestamp,
  };
  if (r.status !== null) m.status = r.status as MessageStatus;
  return m;
}

export class SqliteConversationStore {
  private readonly insertConv: Database.Statement;
  private readonly listConv: Database.Statement;
  private readonly getConv: Database.Statement;
  private readonly deleteConv: Database.Statement;

  private readonly insertMsg: Database.Statement;
  private readonly listMsgs: Database.Statement;
  private readonly deleteMsgsForConv: Database.Statement;
  private readonly deleteMsg: Database.Statement;
  private readonly findMsg: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.insertConv = db.prepare(`
      INSERT INTO conversations
        (id, type, title, participantsJson, lastMessagePreview, lastMessageAt, unreadCount, createdAt, updatedAt, summary)
      VALUES
        (@id, @type, @title, @participantsJson, @lastMessagePreview, @lastMessageAt, @unreadCount, @createdAt, @updatedAt, @summary)
      ON CONFLICT(id) DO UPDATE SET
        type=excluded.type,
        title=excluded.title,
        participantsJson=excluded.participantsJson,
        lastMessagePreview=excluded.lastMessagePreview,
        lastMessageAt=excluded.lastMessageAt,
        unreadCount=excluded.unreadCount,
        createdAt=excluded.createdAt,
        updatedAt=excluded.updatedAt,
        summary=excluded.summary
    `);
    this.listConv = db.prepare(`
      SELECT * FROM conversations
      ORDER BY COALESCE(lastMessageAt, updatedAt) DESC
    `);
    this.getConv = db.prepare(`SELECT * FROM conversations WHERE id = ?`);
    this.deleteConv = db.prepare(`DELETE FROM conversations WHERE id = ?`);

    this.insertMsg = db.prepare(`
      INSERT INTO messages
        (id, conversationId, senderJson, contentType, contentJson, timestamp, status)
      VALUES
        (@id, @conversationId, @senderJson, @contentType, @contentJson, @timestamp, @status)
      ON CONFLICT(id) DO UPDATE SET
        conversationId=excluded.conversationId,
        senderJson=excluded.senderJson,
        contentType=excluded.contentType,
        contentJson=excluded.contentJson,
        timestamp=excluded.timestamp,
        status=excluded.status
    `);
    this.listMsgs = db.prepare(`
      SELECT * FROM messages WHERE conversationId = ? ORDER BY timestamp ASC
    `);
    this.deleteMsgsForConv = db.prepare(`DELETE FROM messages WHERE conversationId = ?`);
    this.deleteMsg = db.prepare(`DELETE FROM messages WHERE conversationId = ? AND id = ?`);
    this.findMsg = db.prepare(`SELECT * FROM messages WHERE id = ?`);
  }

  listConversations(): Conversation[] {
    return (this.listConv.all() as ConversationRow[]).map(rowToConversation);
  }

  getConversation(id: string): Conversation | undefined {
    const row = this.getConv.get(id) as ConversationRow | undefined;
    return row ? rowToConversation(row) : undefined;
  }

  upsertConversation(c: Conversation): void {
    this.insertConv.run({
      id: c.id,
      type: c.type,
      title: c.title ?? null,
      participantsJson: JSON.stringify(c.participants),
      lastMessagePreview: c.lastMessagePreview ?? null,
      lastMessageAt: c.lastMessageAt ?? null,
      unreadCount: c.unreadCount,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      summary: c.summary ?? null,
    });
  }

  removeConversation(id: string): void {
    this.db.transaction(() => {
      this.deleteMsgsForConv.run(id);
      this.deleteConv.run(id);
    })();
  }

  listMessages(conversationId: string): ChatMessage[] {
    return (this.listMsgs.all(conversationId) as MessageRow[]).map(rowToMessage);
  }

  appendMessages(conversationId: string, msgs: ChatMessage[]): void {
    const insert = this.insertMsg;
    this.db.transaction(() => {
      for (const m of msgs) {
        insert.run({
          id: m.id,
          conversationId: m.conversationId,
          senderJson: JSON.stringify(m.sender),
          contentType: m.contentType,
          contentJson: JSON.stringify(m.content),
          timestamp: m.timestamp,
          status: m.status ?? null,
        });
      }
    })();
  }

  upsertMessage(m: ChatMessage): void {
    this.insertMsg.run({
      id: m.id,
      conversationId: m.conversationId,
      senderJson: JSON.stringify(m.sender),
      contentType: m.contentType,
      contentJson: JSON.stringify(m.content),
      timestamp: m.timestamp,
      status: m.status ?? null,
    });
  }

  deleteMessage(conversationId: string, id: string): void {
    this.deleteMsg.run(conversationId, id);
  }

  /** Insert a synthetic message keyed by either a caller-provided `tempId`
   *  or a fresh `temp-*` one (when omitted). Returns the id for later
   *  `replaceOptimistic` / `markOptimisticFailed` correlation. Re-inserting
   *  with the same `tempId` is intentionally idempotent — the underlying
   *  `INSERT OR REPLACE` resets `status: 'sending'`, which is what the
   *  retry-after-failure flow needs. */
  addOptimisticMessage(
    seed: Omit<ChatMessage, 'id' | 'timestamp' | 'status'>,
    tempId?: string,
  ): string {
    const id = tempId ?? `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const msg: ChatMessage = {
      ...seed,
      id,
      timestamp: new Date().toISOString(),
      status: 'sending',
    };
    this.upsertMessage(msg);
    return id;
  }

  replaceOptimistic(tempId: string, real: ChatMessage): void {
    this.deleteMessage(real.conversationId, tempId);
    this.upsertMessage(real);
  }

  markOptimisticFailed(tempId: string): void {
    const row = this.findMsg.get(tempId) as MessageRow | undefined;
    if (!row) return;
    const m = rowToMessage(row);
    this.upsertMessage({ ...m, status: 'failed' });
  }

  findMessageById(id: string): ChatMessage | undefined {
    const row = this.findMsg.get(id) as MessageRow | undefined;
    return row ? rowToMessage(row) : undefined;
  }

  /** Wipe every conversation, message, and sync-state row in one
   *  transaction. Used on user switch so account A's chat history
   *  never leaks into account B. Schema (`_migrations`) is preserved. */
  clearAll(): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages').run();
      this.db.prepare('DELETE FROM conversations').run();
      this.db.prepare('DELETE FROM syncState').run();
    })();
  }
}
