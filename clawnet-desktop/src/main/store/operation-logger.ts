// src/main/store/operation-logger.ts
//
// 1:1 port of macOS OperationLogger.swift. Workspace-local JSONL persistence
// at <wsRoot>/.clawnet/logs/<UTC-date>.jsonl with full query/find/isUndone API.
//
// Also exports AppAuditLogger (the previous app-level P1E logger) + the
// OperationEntry type for use by agent command handlers.

import { stat, readdir, readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { logsDir, ensureDirectory } from '../utils/workspace-data';
import { LogEntrySchema, type LogEntry, type LogFilter, type LogQueryResult } from '../../shared/domain/operation';

export type { LogEntry, LogFilter, LogQueryResult } from '../../shared/domain/operation';

// ============================================================
// New macOS-parity OperationLogger
// ============================================================

export function generateOperationId(): string {
  return 'op_' + randomBytes(4).toString('hex');
}

function dateString(timestampMs: number): string {
  const d = new Date(timestampMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export class OperationLogger {
  async log(entry: LogEntry, wsRoot: string): Promise<void> {
    const dir = logsDir(wsRoot);
    await ensureDirectory(dir);
    const file = join(dir, dateString(entry.timestamp) + '.jsonl');
    const line = JSON.stringify(entry) + '\n';
    try {
      await stat(file);
      await appendFile(file, line, 'utf-8');
    } catch {
      await writeFile(file, line, 'utf-8');
    }
  }

  async query(filter: LogFilter, wsRoot: string): Promise<LogQueryResult> {
    const dir = logsDir(wsRoot);
    let files: string[];
    try { files = await readdir(dir); } catch { return { entries: [], total: 0, hasMore: false }; }
    // Default: no time restriction (0 = epoch, MAX_SAFE_INTEGER = far future).
    // Callers that want today-only behaviour should pass explicit since/until.
    const since = filter.since ?? 0;
    const until = filter.until ?? Number.MAX_SAFE_INTEGER;
    const sinceDate = dateString(since);
    const untilDate = dateString(until);

    const all: LogEntry[] = [];
    const sortedFiles = files.filter((f) => f.endsWith('.jsonl')).sort();
    for (const f of sortedFiles) {
      const dateStr = f.slice(0, -6); // remove ".jsonl"
      if (dateStr < sinceDate || dateStr > untilDate) continue;
      let content: string;
      try { content = await readFile(join(dir, f), 'utf-8'); } catch { continue; }
      for (const line of content.split('\n')) {
        if (!line) continue;
        let parsedJson: unknown;
        try { parsedJson = JSON.parse(line); } catch { continue; }
        const parsed = LogEntrySchema.safeParse(parsedJson);
        if (!parsed.success) continue;
        const e = parsed.data;
        if (e.timestamp < since || e.timestamp > until) continue;
        if (filter.sessionId !== undefined && e.sessionId !== filter.sessionId) continue;
        if (filter.command !== undefined && e.command !== filter.command) continue;
        all.push(e);
      }
    }

    all.sort((a, b) => b.timestamp - a.timestamp);
    const limit = filter.limit;
    const offset = Math.min(filter.offset, all.length);
    const end = Math.min(offset + limit, all.length);
    return { entries: all.slice(offset, end), total: all.length, hasMore: end < all.length };
  }

  async findEntry(operationId: string, wsRoot: string): Promise<LogEntry | null> {
    const dir = logsDir(wsRoot);
    let files: string[];
    try { files = await readdir(dir); } catch { return null; }
    const sorted = files.filter((f) => f.endsWith('.jsonl')).sort().reverse();
    for (const f of sorted) {
      let content: string;
      try { content = await readFile(join(dir, f), 'utf-8'); } catch { continue; }
      for (const line of content.split('\n')) {
        if (!line) continue;
        let parsedJson: unknown;
        try { parsedJson = JSON.parse(line); } catch { continue; }
        const parsed = LogEntrySchema.safeParse(parsedJson);
        if (parsed.success && parsed.data.id === operationId) return parsed.data;
      }
    }
    return null;
  }

  async isUndone(operationId: string, wsRoot: string): Promise<boolean> {
    const dir = logsDir(wsRoot);
    let files: string[];
    try { files = await readdir(dir); } catch { return false; }
    const sorted = files.filter((f) => f.endsWith('.jsonl')).sort().reverse();
    for (const f of sorted) {
      let content: string;
      try { content = await readFile(join(dir, f), 'utf-8'); } catch { continue; }
      for (const line of content.split('\n')) {
        if (!line) continue;
        let parsedJson: unknown;
        try { parsedJson = JSON.parse(line); } catch { continue; }
        const parsed = LogEntrySchema.safeParse(parsedJson);
        if (parsed.success && parsed.data.type === 'undo' && parsed.data.undoTargetId === operationId) {
          return true;
        }
      }
    }
    return false;
  }
}

// ============================================================
// P1E compatibility: app-level audit logger for consent-UI flow
// ============================================================

export interface OperationEntry {
  kind: string;
  agentId?: string;
  path?: string;
  op?: string;
  decision?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

interface StoredEntry extends OperationEntry {
  timestamp: string;
}

export class AppAuditLogger {
  constructor(private readonly logsDir: string) {}
  async record(entry: OperationEntry): Promise<void> {
    const now = new Date();
    const stored: StoredEntry = { ...entry, timestamp: now.toISOString() };
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    const filename = `ops-${y}-${m}-${d}.jsonl`;
    const filePath = join(this.logsDir, filename);
    await mkdir(this.logsDir, { recursive: true });
    await appendFile(filePath, JSON.stringify(stored) + '\n', { encoding: 'utf-8' });
  }
}
