import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationStore } from '../conversation-store';
import type { Conversation, ChatMessage } from '../../../shared/domain/chat';

interface KvLite {
  get<T>(k: string): T | undefined;
  set(k: string, v: unknown): void;
}
class MemKv implements KvLite {
  private m = new Map<string, unknown>();
  get<T>(k: string) { return this.m.get(k) as T | undefined; }
  set(k: string, v: unknown) { this.m.set(k, v); }
}

const conv = (id: string, lastAt: string): Conversation => ({
  id, type: 'direct', participants: [],
  unreadCount: 0, createdAt: lastAt, updatedAt: lastAt, lastMessageAt: lastAt,
});

const msg = (id: string, conversationId: string, text: string, ts: string): ChatMessage => ({
  id, conversationId,
  sender: { id: 'u1', name: 'A', type: 'human' },
  contentType: 'text', content: { text },
  timestamp: ts, status: 'sent',
});

let kv: MemKv;
let store: ConversationStore;
beforeEach(() => {
  kv = new MemKv();
  store = new ConversationStore(kv);
});

describe('ConversationStore.conversations', () => {
  it('upsert + list returns by lastMessageAt desc', () => {
    store.upsertConversation(conv('a', '2026-01-01T00:00:00Z'));
    store.upsertConversation(conv('b', '2026-03-01T00:00:00Z'));
    store.upsertConversation(conv('c', '2026-02-01T00:00:00Z'));
    expect(store.listConversations().map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('upsert replaces existing by id', () => {
    store.upsertConversation(conv('a', '2026-01-01T00:00:00Z'));
    store.upsertConversation({ ...conv('a', '2026-04-01T00:00:00Z'), unreadCount: 5 });
    const list = store.listConversations();
    expect(list).toHaveLength(1);
    expect(list[0]?.unreadCount).toBe(5);
  });

  it('persists across new instances on same kv', () => {
    store.upsertConversation(conv('a', '2026-01-01T00:00:00Z'));
    const store2 = new ConversationStore(kv);
    expect(store2.listConversations()).toHaveLength(1);
  });
});

describe('ConversationStore.messages', () => {
  it('appendMessages preserves order, dedupes by id', () => {
    store.appendMessages('c1', [
      msg('m1', 'c1', 'hi', '2026-01-01T00:00:00Z'),
      msg('m2', 'c1', 'there', '2026-01-01T00:00:01Z'),
    ]);
    store.appendMessages('c1', [
      msg('m2', 'c1', 'there (dup)', '2026-01-01T00:00:01Z'),
      msg('m3', 'c1', 'how are you', '2026-01-01T00:00:02Z'),
    ]);
    const list = store.listMessages('c1');
    expect(list.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('listMessages returns empty for unknown conversation', () => {
    expect(store.listMessages('nope')).toEqual([]);
  });

  it('upsertMessage replaces existing by id', () => {
    store.appendMessages('c1', [msg('m1', 'c1', 'old', '2026-01-01T00:00:00Z')]);
    store.upsertMessage({ ...msg('m1', 'c1', 'new', '2026-01-01T00:00:00Z'), status: 'read' });
    expect(store.listMessages('c1')[0]?.content.text).toBe('new');
    expect(store.listMessages('c1')[0]?.status).toBe('read');
  });

  it('deleteMessage removes by id', () => {
    store.appendMessages('c1', [
      msg('m1', 'c1', 'a', '2026-01-01T00:00:00Z'),
      msg('m2', 'c1', 'b', '2026-01-01T00:00:01Z'),
    ]);
    store.deleteMessage('c1', 'm1');
    expect(store.listMessages('c1').map((m) => m.id)).toEqual(['m2']);
  });
});

describe('ConversationStore — optimistic messages (mirrors ChatService.swift:569-607)', () => {
  it('addOptimisticMessage inserts with sending status and a temp id', () => {
    const tempId = store.addOptimisticMessage({
      conversationId: 'c1',
      sender: { id: 'u1', name: 'u', type: 'human' },
      contentType: 'file',
      content: { name: 'a.txt', size: 5 },
    });
    expect(tempId).toMatch(/^temp-/);
    const messages = store.listMessages('c1');
    const inserted = messages.find((m) => m.id === tempId);
    expect(inserted?.status).toBe('sending');
    expect(inserted?.content.name).toBe('a.txt');
  });

  it('replaceOptimistic swaps the temp message for the real one', () => {
    const tempId = store.addOptimisticMessage({
      conversationId: 'c1',
      sender: { id: 'u1', name: 'u', type: 'human' },
      contentType: 'file',
      content: {},
    });
    store.replaceOptimistic(tempId, {
      id: 'm1',
      conversationId: 'c1',
      sender: { id: 'u1', name: 'u', type: 'human' },
      contentType: 'file',
      content: {},
      timestamp: '2026-05-11T00:00:00Z',
      status: 'sent',
    });
    const messages = store.listMessages('c1');
    expect(messages.find((m) => m.id === 'm1')).toBeDefined();
    expect(messages.find((m) => m.id === tempId)).toBeUndefined();
  });

  it('markOptimisticFailed sets status=failed', () => {
    const tempId = store.addOptimisticMessage({
      conversationId: 'c1',
      sender: { id: 'u1', name: 'u', type: 'human' },
      contentType: 'file',
      content: {},
    });
    store.markOptimisticFailed(tempId);
    const messages = store.listMessages('c1');
    expect(messages.find((m) => m.id === tempId)?.status).toBe('failed');
  });

  it('markOptimisticFailed is a no-op for unknown id', () => {
    expect(() => store.markOptimisticFailed('temp-unknown')).not.toThrow();
  });

  it('findMessageById locates messages across conversations', () => {
    store.appendMessages('c1', [msg('m1', 'c1', 'x', '2026-01-01T00:00:00Z')]);
    store.appendMessages('c2', [msg('m2', 'c2', 'y', '2026-01-01T00:00:01Z')]);
    expect(store.findMessageById('m1')?.conversationId).toBe('c1');
    expect(store.findMessageById('m2')?.conversationId).toBe('c2');
    expect(store.findMessageById('m9')).toBeUndefined();
  });
});
