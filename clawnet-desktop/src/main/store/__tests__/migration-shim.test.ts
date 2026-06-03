import { describe, it, expect, beforeEach } from 'vitest';
import { migrateJsonToSqlite } from '../migration-shim';
import { SqliteConversationStore } from '../sqlite-conversation-store';
import { openDatabase } from '../db/schema';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Conversation, ChatMessage } from '../../../shared/domain/chat';

function mockKv() {
  const map = new Map<string, unknown>();
  return {
    map,
    get: <T>(k: string) => map.get(k) as T | undefined,
    set: (k: string, v: unknown) => { map.set(k, v); },
    delete: (k: string) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
}

const FLAG_KEY = 'db.migrated_at_v1';

const aliceConv: Conversation = {
  id: 'c1', type: 'direct',
  participants: [{ id: 'u1', name: 'Alice', type: 'human' }],
  unreadCount: 0,
  createdAt: '2026-05-13T00:00:00Z',
  updatedAt: '2026-05-13T00:00:00Z',
};
const aliceMsg: ChatMessage = {
  id: 'm1', conversationId: 'c1',
  sender: { id: 'u1', name: 'Alice', type: 'human' },
  contentType: 'text', content: { text: 'hi' },
  timestamp: '2026-05-13T00:00:00Z',
};

describe('migrateJsonToSqlite', () => {
  let dir: string;
  let store: SqliteConversationStore;
  let kv: ReturnType<typeof mockKv>;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mig-'));
    const db = openDatabase(join(dir, 'clawnet.db'));
    store = new SqliteConversationStore(db);
    kv = mockKv();
  });

  it('runs migration on fresh boot with JSON data; flag is set after', () => {
    kv.set('chat.conversations', [aliceConv]);
    kv.set('chat.messages', { c1: [aliceMsg] });
    migrateJsonToSqlite(kv, store);
    expect(store.listConversations()).toEqual([aliceConv]);
    expect(store.listMessages('c1')).toEqual([aliceMsg]);
    expect(kv.get<string>(FLAG_KEY)).toBeDefined();
  });

  it('second boot is a no-op when flag is set', () => {
    kv.set(FLAG_KEY, '2026-05-13T00:00:00Z');
    kv.set('chat.conversations', [aliceConv]);
    kv.set('chat.messages', { c1: [aliceMsg] });
    migrateJsonToSqlite(kv, store);
    expect(store.listConversations()).toEqual([]);
  });

  it('first boot with no JSON data still sets flag (clean install)', () => {
    migrateJsonToSqlite(kv, store);
    expect(kv.get<string>(FLAG_KEY)).toBeDefined();
    expect(store.listConversations()).toEqual([]);
  });

  it('survives corrupted JSON (silently skips bad rows, completes migration)', () => {
    kv.set('chat.conversations', [aliceConv, { invalid: 'shape' }]);
    kv.set('chat.messages', { c1: [aliceMsg, { still: 'broken' }] });
    migrateJsonToSqlite(kv, store);
    expect(store.listConversations()).toEqual([aliceConv]);
    expect(store.listMessages('c1')).toEqual([aliceMsg]);
    expect(kv.get<string>(FLAG_KEY)).toBeDefined();
  });
});
