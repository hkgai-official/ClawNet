// src/main/store/db/schema.ts
//
// 1:1 port of macOS LocalStore.swift:39-95 (GRDB migrator).
// Migrations are tracked in a `_migrations` table; applying the same
// migration twice is a no-op.

import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

type DbType = Database.Database;

interface Migration {
  name: string;
  apply(db: DbType): void;
}

const MIGRATIONS: Migration[] = [
  {
    name: 'v1_create_tables',
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY NOT NULL,
          type TEXT NOT NULL,
          title TEXT,
          participantsJson TEXT NOT NULL DEFAULT '[]',
          lastMessagePreview TEXT,
          lastMessageAt TEXT,
          unreadCount INTEGER NOT NULL DEFAULT 0,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY NOT NULL,
          conversationId TEXT NOT NULL,
          senderJson TEXT NOT NULL,
          contentType TEXT NOT NULL,
          contentJson TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          status TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conv_time
          ON messages (conversationId, timestamp);
        CREATE TABLE IF NOT EXISTS syncState (
          conversationId TEXT PRIMARY KEY NOT NULL,
          lastSyncedMessageId TEXT,
          lastSyncedAt TEXT,
          hasMoreHistory INTEGER NOT NULL DEFAULT 1
        );
      `);
    },
  },
  {
    name: 'v2_add_content_raw',
    apply(db) {
      const cols = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'contentRawJson')) {
        db.exec("ALTER TABLE messages ADD COLUMN contentRawJson TEXT");
      }
    },
  },
  {
    name: 'v3_add_summary',
    apply(db) {
      const cols = db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'summary')) {
        db.exec("ALTER TABLE conversations ADD COLUMN summary TEXT");
      }
    },
  },
];

function applyMigrations(db: DbType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY NOT NULL,
      appliedAt TEXT NOT NULL
    );
  `);
  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>).map((r) => r.name),
  );
  const insert = db.prepare('INSERT INTO _migrations (name, appliedAt) VALUES (?, ?)');
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    db.transaction(() => {
      m.apply(db);
      insert.run(m.name, new Date().toISOString());
    })();
  }
}

export function openDatabase(path: string): DbType {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}
