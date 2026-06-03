// src/main/store/__tests__/bookmark-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BookmarkStore } from '../bookmark-store';

let tmp: string;
let path: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'clawnet-bm-'));
  path = join(tmp, 'file_access.json');
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('BookmarkStore', () => {
  it('starts empty when file missing', async () => {
    const s = new BookmarkStore(path);
    await s.load();
    expect(s.list()).toEqual([]);
  });

  it('add() then list() returns the entry', async () => {
    const s = new BookmarkStore(path);
    await s.load();
    s.add({ path: 'C:\\Users\\x\\Workspace', label: 'work', grantedTo: ['all'] });
    expect(s.list()).toHaveLength(1);
    expect(s.list()[0]?.path).toBe('C:\\Users\\x\\Workspace');
  });

  it('flush() persists to disk; reload reads back', async () => {
    const s = new BookmarkStore(path);
    await s.load();
    s.add({ path: 'C:\\A', label: 'a', grantedTo: ['all'] });
    await s.flush();
    expect(existsSync(path)).toBe(true);
    const s2 = new BookmarkStore(path);
    await s2.load();
    expect(s2.list()).toHaveLength(1);
  });

  it('remove() drops by path', async () => {
    const s = new BookmarkStore(path);
    await s.load();
    s.add({ path: 'C:\\A', label: 'a', grantedTo: ['all'] });
    s.add({ path: 'C:\\B', label: 'b', grantedTo: ['all'] });
    s.remove('C:\\A');
    expect(s.list().map((e) => e.path)).toEqual(['C:\\B']);
  });

  it('isAllowed() returns true for path under an allowed bookmark (dir boundary)', async () => {
    const s = new BookmarkStore(path);
    await s.load();
    s.add({ path: 'C:\\Users\\x\\Workspace', label: 'work', grantedTo: ['all'] });
    expect(s.isAllowed('C:\\Users\\x\\Workspace\\sub\\file.txt')).toBe(true);
    expect(s.isAllowed('C:\\Users\\x\\Workspace')).toBe(true);
    expect(s.isAllowed('C:\\Users\\x\\WorkspaceX\\file.txt')).toBe(false);
    expect(s.isAllowed('C:\\Users\\y\\Workspace\\file.txt')).toBe(false);
  });

  it('isAllowed() is case-insensitive on Windows-style paths', async () => {
    const s = new BookmarkStore(path);
    await s.load();
    s.add({ path: 'C:\\Users\\X\\Workspace', label: 'w', grantedTo: ['all'] });
    expect(s.isAllowed('c:\\users\\x\\workspace\\file.txt')).toBe(true);
  });

  it('clear() wipes everything and removes file', async () => {
    const s = new BookmarkStore(path);
    await s.load();
    s.add({ path: 'C:\\A', label: 'a', grantedTo: ['all'] });
    await s.flush();
    await s.clear();
    expect(existsSync(path)).toBe(false);
    expect(s.list()).toEqual([]);
  });

  it('flush() writes atomic (temp file then rename)', async () => {
    const s = new BookmarkStore(path);
    await s.load();
    s.add({ path: 'C:\\A', label: 'a', grantedTo: ['all'] });
    await s.flush();
    const raw = readFileSync(path, 'utf-8');
    const obj = JSON.parse(raw);
    expect(obj.version).toBe(1);
    expect(obj.entries).toHaveLength(1);
  });
});
