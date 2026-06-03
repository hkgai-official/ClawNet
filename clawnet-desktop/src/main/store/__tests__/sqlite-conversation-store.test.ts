import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteConversationStore } from '../sqlite-conversation-store';
import { openDatabase } from '../db/schema';
import type { Conversation, ChatMessage, Participant } from '../../../shared/domain/chat';

function participant(over: Partial<Participant> = {}): Participant {
  return { id: 'u1', name: 'Alice', type: 'human', ...over };
}
function conversation(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1', type: 'direct', participants: [participant()],
    unreadCount: 0,
    createdAt: '2026-05-13T00:00:00Z', updatedAt: '2026-05-13T00:00:00Z',
    ...over,
  };
}
function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1', conversationId: 'c1',
    sender: participant(),
    contentType: 'text', content: { text: 'hello' },
    timestamp: '2026-05-13T00:00:00Z',
    ...over,
  };
}

describe('SqliteConversationStore', () => {
  let dir: string;
  let store: SqliteConversationStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'scs-'));
    const db = openDatabase(join(dir, 'clawnet.db'));
    store = new SqliteConversationStore(db);
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('listConversations returns empty on fresh store', () => {
    expect(store.listConversations()).toEqual([]);
  });

  it('upsertConversation inserts then listConversations returns it', () => {
    const c = conversation();
    store.upsertConversation(c);
    expect(store.listConversations()).toEqual([c]);
  });

  it('upsertConversation updates existing row by id', () => {
    store.upsertConversation(conversation({ title: 'old' }));
    store.upsertConversation(conversation({ title: 'new' }));
    const list = store.listConversations();
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('new');
  });

  it('listConversations sorts by lastMessageAt desc, falling back to updatedAt', () => {
    store.upsertConversation(conversation({ id: 'c-old', lastMessageAt: '2026-05-10T00:00:00Z' }));
    store.upsertConversation(conversation({ id: 'c-new', lastMessageAt: '2026-05-13T00:00:00Z' }));
    store.upsertConversation(conversation({ id: 'c-no-last', updatedAt: '2026-05-12T00:00:00Z' }));
    expect(store.listConversations().map((c) => c.id)).toEqual(['c-new', 'c-no-last', 'c-old']);
  });

  it('getConversation returns undefined for missing id, row for present id', () => {
    expect(store.getConversation('absent')).toBeUndefined();
    const c = conversation();
    store.upsertConversation(c);
    expect(store.getConversation('c1')).toEqual(c);
  });

  it('removeConversation deletes conversation + cascades its messages', () => {
    store.upsertConversation(conversation());
    store.appendMessages('c1', [message({ id: 'm1' }), message({ id: 'm2' })]);
    store.removeConversation('c1');
    expect(store.getConversation('c1')).toBeUndefined();
    expect(store.listMessages('c1')).toEqual([]);
  });

  it('listMessages returns empty for unknown conversation', () => {
    expect(store.listMessages('c-absent')).toEqual([]);
  });

  it('appendMessages inserts new messages, dedups by id', () => {
    store.upsertConversation(conversation());
    store.appendMessages('c1', [message({ id: 'm1' }), message({ id: 'm2' })]);
    store.appendMessages('c1', [message({ id: 'm2' }), message({ id: 'm3' })]);
    expect(store.listMessages('c1').map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('listMessages returns messages sorted by timestamp asc', () => {
    store.upsertConversation(conversation());
    store.appendMessages('c1', [
      message({ id: 'm2', timestamp: '2026-05-13T00:00:02Z' }),
      message({ id: 'm1', timestamp: '2026-05-13T00:00:01Z' }),
      message({ id: 'm3', timestamp: '2026-05-13T00:00:03Z' }),
    ]);
    expect(store.listMessages('c1').map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('upsertMessage inserts new, updates existing by id', () => {
    store.upsertConversation(conversation());
    store.upsertMessage(message({ id: 'm1', content: { text: 'first' } }));
    store.upsertMessage(message({ id: 'm1', content: { text: 'edited' } }));
    const msgs = store.listMessages('c1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content.text).toBe('edited');
  });

  it('deleteMessage removes by (conversationId, id)', () => {
    store.upsertConversation(conversation());
    store.appendMessages('c1', [message({ id: 'm1' }), message({ id: 'm2' })]);
    store.deleteMessage('c1', 'm1');
    expect(store.listMessages('c1').map((m) => m.id)).toEqual(['m2']);
  });

  it('addOptimisticMessage inserts with temp- id and status="sending"', () => {
    store.upsertConversation(conversation());
    const tempId = store.addOptimisticMessage({
      conversationId: 'c1', sender: participant(),
      contentType: 'text', content: { text: 'sending...' },
    });
    expect(tempId).toMatch(/^temp-/);
    const m = store.findMessageById(tempId);
    expect(m?.status).toBe('sending');
  });

  it('addOptimisticMessage respects caller-provided tempId', () => {
    store.upsertConversation(conversation());
    const id = store.addOptimisticMessage(
      {
        conversationId: 'c1', sender: participant(),
        contentType: 'text', content: { text: 'x' },
      },
      'my-custom-temp',
    );
    expect(id).toBe('my-custom-temp');
    expect(store.findMessageById('my-custom-temp')).toBeDefined();
    expect(store.findMessageById('my-custom-temp')?.status).toBe('sending');
  });

  it('addOptimisticMessage with same tempId twice upserts (retry path)', () => {
    store.upsertConversation(conversation());
    store.addOptimisticMessage(
      { conversationId: 'c1', sender: participant(), contentType: 'text', content: { text: 'x' } },
      'temp-x',
    );
    store.markOptimisticFailed('temp-x');
    expect(store.findMessageById('temp-x')?.status).toBe('failed');
    store.addOptimisticMessage(
      { conversationId: 'c1', sender: participant(), contentType: 'text', content: { text: 'x' } },
      'temp-x',
    );
    expect(store.findMessageById('temp-x')?.status).toBe('sending');
  });

  it('replaceOptimistic swaps temp message for real one', () => {
    store.upsertConversation(conversation());
    const tempId = store.addOptimisticMessage({
      conversationId: 'c1', sender: participant(),
      contentType: 'text', content: { text: 'x' },
    });
    const real = message({ id: 'real-1', content: { text: 'x' }, status: 'sent' });
    store.replaceOptimistic(tempId, real);
    expect(store.findMessageById(tempId)).toBeUndefined();
    expect(store.findMessageById('real-1')?.status).toBe('sent');
  });

  it('markOptimisticFailed sets status=failed (keeps message visible)', () => {
    store.upsertConversation(conversation());
    const tempId = store.addOptimisticMessage({
      conversationId: 'c1', sender: participant(),
      contentType: 'text', content: { text: 'x' },
    });
    store.markOptimisticFailed(tempId);
    expect(store.findMessageById(tempId)?.status).toBe('failed');
  });

  it('findMessageById returns undefined for missing id', () => {
    expect(store.findMessageById('absent')).toBeUndefined();
  });

  it('findMessageById finds across multiple conversations', () => {
    store.upsertConversation(conversation({ id: 'c-a' }));
    store.upsertConversation(conversation({ id: 'c-b' }));
    store.appendMessages('c-a', [message({ id: 'm-a', conversationId: 'c-a' })]);
    store.appendMessages('c-b', [message({ id: 'm-b', conversationId: 'c-b' })]);
    expect(store.findMessageById('m-b')?.conversationId).toBe('c-b');
  });

  it('clearAll wipes conversations + messages + syncState (cross-account leak guard)', () => {
    store.upsertConversation(conversation({ id: 'c-a' }));
    store.upsertConversation(conversation({ id: 'c-b' }));
    store.appendMessages('c-a', [message({ id: 'm-a1', conversationId: 'c-a' })]);
    store.appendMessages('c-b', [message({ id: 'm-b1', conversationId: 'c-b' })]);
    // Seed syncState directly via raw DB so we can verify it's wiped too.
    const db = (store as unknown as { db: import('better-sqlite3').Database }).db;
    db.prepare(
      'INSERT INTO syncState (conversationId, lastSyncedMessageId, lastSyncedAt, hasMoreHistory) VALUES (?, ?, ?, 1)',
    ).run('c-a', 'm-a1', '2026-05-13T00:00:00Z');

    store.clearAll();

    expect(store.listConversations()).toEqual([]);
    expect(store.listMessages('c-a')).toEqual([]);
    expect(store.listMessages('c-b')).toEqual([]);
    expect(store.findMessageById('m-a1')).toBeUndefined();
    const syncRows = db.prepare('SELECT COUNT(*) as n FROM syncState').get() as { n: number };
    expect(syncRows.n).toBe(0);
  });

  it('handles conversations with summary + lastMessagePreview round-trip', () => {
    const c = conversation({
      summary: 'agent task — extract invoices',
      lastMessagePreview: '...all invoices extracted',
      lastMessageAt: '2026-05-13T12:00:00Z',
    });
    store.upsertConversation(c);
    expect(store.getConversation('c1')).toEqual(c);
  });
});
