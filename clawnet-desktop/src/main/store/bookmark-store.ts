import { readFile, writeFile, rm, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { win32 } from 'node:path';
import { createHash } from 'node:crypto';

export interface BookmarkEntry {
  path: string;
  label?: string;
  addedAt: string;
  grantedTo: string[];  // 'all' | `agent:<id>`
  lastUsedAt?: string;
  checksum?: string;
}

interface FileSchema {
  version: 1;
  entries: BookmarkEntry[];
}

function normalizePath(p: string): string {
  return win32.resolve(p).toLowerCase();
}

function checksum(p: string): string {
  return createHash('sha256').update(p).digest('hex');
}

export class BookmarkStore {
  private entries: BookmarkEntry[] = [];

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    if (!existsSync(this.path)) {
      this.entries = [];
      return;
    }
    try {
      const raw = await readFile(this.path, 'utf-8');
      const parsed = JSON.parse(raw) as FileSchema;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
        this.entries = [];
        return;
      }
      this.entries = parsed.entries;
    } catch {
      this.entries = [];
    }
  }

  list(): BookmarkEntry[] {
    return [...this.entries];
  }

  add(input: { path: string; label?: string; grantedTo: string[] }): void {
    const now = new Date().toISOString();
    const existingIdx = this.entries.findIndex((e) => normalizePath(e.path) === normalizePath(input.path));
    const entry: BookmarkEntry = {
      path: input.path,
      addedAt: existingIdx >= 0 ? (this.entries[existingIdx]!.addedAt ?? now) : now,
      grantedTo: input.grantedTo,
      checksum: checksum(input.path),
      ...(input.label !== undefined ? { label: input.label } : {}),
    };
    if (existingIdx >= 0) this.entries[existingIdx] = entry;
    else this.entries.push(entry);
  }

  remove(p: string): void {
    const np = normalizePath(p);
    this.entries = this.entries.filter((e) => normalizePath(e.path) !== np);
  }

  isAllowed(requestPath: string): boolean {
    const req = normalizePath(requestPath);
    return this.entries.some((e) => {
      const allowed = normalizePath(e.path);
      if (req === allowed) return true;
      return req.startsWith(allowed + win32.sep.toLowerCase());
    });
  }

  async flush(): Promise<void> {
    const obj: FileSchema = { version: 1, entries: this.entries };
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = this.path + '.tmp';
    await writeFile(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
    await rename(tmp, this.path);
  }

  async clear(): Promise<void> {
    this.entries = [];
    if (existsSync(this.path)) await rm(this.path);
  }
}
