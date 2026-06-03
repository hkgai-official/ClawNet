import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../schema';

describe('openDatabase', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'db-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('creates the file and applies all migrations on a fresh database', () => {
    const db = openDatabase(join(dir, 'clawnet.db'));
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('conversations');
    expect(names).toContain('messages');
    expect(names).toContain('syncState');
    expect(names).toContain('_migrations');
    db.close();
  });

  it('reopen on an existing database is a no-op (idempotent migrations)', () => {
    const path = join(dir, 'clawnet.db');
    const db1 = openDatabase(path);
    db1.prepare("INSERT INTO conversations (id, type, participantsJson, unreadCount, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
      .run('c1', 'direct', '[]', 0, '2026-05-13T00:00:00Z', '2026-05-13T00:00:00Z');
    db1.close();
    const db2 = openDatabase(path);
    const row = db2.prepare('SELECT id FROM conversations WHERE id = ?').get('c1') as { id: string } | undefined;
    expect(row?.id).toBe('c1');
    db2.close();
  });

  it('has v2 contentRawJson column and v3 summary column', () => {
    const db = openDatabase(join(dir, 'clawnet.db'));
    const msgCols = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
    const convCols = db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
    expect(msgCols.map((c) => c.name)).toContain('contentRawJson');
    expect(convCols.map((c) => c.name)).toContain('summary');
    db.close();
  });

  it('has idx_messages_conv_time index', () => {
    const db = openDatabase(join(dir, 'clawnet.db'));
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_messages_conv_time'").get();
    expect(idx).toBeDefined();
    db.close();
  });
});
