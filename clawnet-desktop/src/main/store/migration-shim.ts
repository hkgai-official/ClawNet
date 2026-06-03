// src/main/store/migration-shim.ts
//
// One-shot migration: legacy JSON KV-backed ConversationStore →
// SqliteConversationStore. Idempotent via a flag in kv prefs.

import type { SqliteConversationStore } from './sqlite-conversation-store';
import { ConversationSchema, ChatMessageSchema, type ChatMessage } from '../../shared/domain/chat';
import type { KvStore } from './kv-store';

const FLAG_KEY = 'db.migrated_at_v1';
const CONVERSATIONS_KEY = 'chat.conversations';
const MESSAGES_KEY = 'chat.messages';

export function migrateJsonToSqlite(
  kv: Pick<KvStore, 'get' | 'set'>,
  store: SqliteConversationStore,
): void {
  if (kv.get<string>(FLAG_KEY)) return;

  const rawConvs = kv.get<unknown[]>(CONVERSATIONS_KEY) ?? [];
  for (const raw of rawConvs) {
    const parsed = ConversationSchema.safeParse(raw);
    if (!parsed.success) continue;
    store.upsertConversation(parsed.data);
  }

  const rawMsgs = kv.get<Record<string, unknown[]>>(MESSAGES_KEY) ?? {};
  for (const [convId, list] of Object.entries(rawMsgs)) {
    const validated: ChatMessage[] = [];
    for (const raw of list) {
      const parsed = ChatMessageSchema.safeParse(raw);
      if (parsed.success) validated.push(parsed.data);
    }
    if (validated.length > 0) store.appendMessages(convId, validated);
  }

  kv.set(FLAG_KEY, new Date().toISOString());
}
