import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFileListHandler } from '../file-list';

const allowPolicy = { check: () => ({ decision: 'allow' as const, reason: '' }) };
function ctx(p: string) { return { invokeId: 'i', paramsJSON: p }; }

interface ListEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  createdAt?: number;
  modifiedAt?: number;
  relativePath?: string;
}

describe('file.list handler', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'list-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('errors on missing path', async () => {
    const h = makeFileListHandler({ policy: allowPolicy });
    expect(JSON.parse(await h(ctx('{}')))).toEqual({ error: 'missing path' });
  });

  it('ENUM_FAILED when path does not exist', async () => {
    const h = makeFileListHandler({ policy: allowPolicy });
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: join(tmp, 'nope') }))));
    expect(r.error).toBe(`ENUM_FAILED: cannot enumerate '${join(tmp, 'nope')}'`);
  });

  it('lists non-recursive direct children only', async () => {
    const h = makeFileListHandler({ policy: allowPolicy });
    await writeFile(join(tmp, 'a.txt'), 'a');
    await mkdir(join(tmp, 'sub'));
    await writeFile(join(tmp, 'sub', 'nested.txt'), 'n');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: tmp }))));
    expect(r.entries.map((e: ListEntry) => e.name).sort()).toEqual(['a.txt', 'sub']);
    expect(r.count).toBe(2);
    expect(r.entries.every((e: ListEntry) => e.relativePath === undefined)).toBe(true);
  });

  it('filters .clawnet from non-recursive', async () => {
    const h = makeFileListHandler({ policy: allowPolicy });
    await writeFile(join(tmp, 'a'), 'a');
    await mkdir(join(tmp, '.clawnet'));
    await writeFile(join(tmp, '.clawnet', 'state'), 's');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: tmp }))));
    expect(r.entries.map((e: ListEntry) => e.name)).toEqual(['a']);
  });

  it('filters hidden files in recursive mode', async () => {
    const h = makeFileListHandler({ policy: allowPolicy });
    await writeFile(join(tmp, 'visible'), 'v');
    await writeFile(join(tmp, '.hidden'), 'h');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: tmp, recursive: true }))));
    expect(r.entries.map((e: ListEntry) => e.name)).toEqual(['visible']);
  });

  it('respects maxDepth in recursive mode', async () => {
    const h = makeFileListHandler({ policy: allowPolicy });
    await mkdir(join(tmp, 'a', 'b', 'c'), { recursive: true });
    await writeFile(join(tmp, 'a', 'depth1'), '1');
    await writeFile(join(tmp, 'a', 'b', 'depth2'), '2');
    await writeFile(join(tmp, 'a', 'b', 'c', 'depth3'), '3');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: tmp, recursive: true, maxDepth: 2 }))));
    const names = (r.entries as ListEntry[]).map((e) => e.name);
    expect(names).toContain('depth1');
    expect(names).toContain('depth2');
    expect(names).not.toContain('depth3');
  });

  it('filters .clawnet in recursive mode and stops descending into it', async () => {
    const h = makeFileListHandler({ policy: allowPolicy });
    await mkdir(join(tmp, '.clawnet', 'trash'), { recursive: true });
    await writeFile(join(tmp, '.clawnet', 'trash', 't.txt'), 't');
    await writeFile(join(tmp, 'visible.txt'), 'v');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: tmp, recursive: true }))));
    const names = (r.entries as ListEntry[]).map((e) => e.name);
    expect(names).toEqual(['visible.txt']);
  });

  it('includes relativePath in recursive mode', async () => {
    const h = makeFileListHandler({ policy: allowPolicy });
    await mkdir(join(tmp, 'sub'));
    await writeFile(join(tmp, 'sub', 'n.txt'), 'n');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: tmp, recursive: true }))));
    const nested = (r.entries as ListEntry[]).find((e) => e.name === 'n.txt');
    expect(nested?.relativePath).toMatch(/sub[/\\]n\.txt/);
  });

  it('clamps maxEntries to 10000', async () => {
    const h = makeFileListHandler({ policy: allowPolicy });
    await writeFile(join(tmp, 'x'), 'x');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: tmp, maxEntries: 50000 }))));
    expect(r.entries.length).toBeLessThanOrEqual(10000);
  });

  it('sorts by name asc by default (locale-aware case-insensitive)', async () => {
    const h = makeFileListHandler({ policy: allowPolicy });
    await writeFile(join(tmp, 'banana'), 'b');
    await writeFile(join(tmp, 'apple'), 'a');
    await writeFile(join(tmp, 'Cherry'), 'c');
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: tmp }))));
    const names = (r.entries as ListEntry[]).map((e) => e.name.toLowerCase());
    expect(names).toEqual(['apple', 'banana', 'cherry']);
  });

  it('sorts by size desc', async () => {
    const h = makeFileListHandler({ policy: allowPolicy });
    await writeFile(join(tmp, 'small'), 'a');
    await writeFile(join(tmp, 'big'), 'a'.repeat(100));
    await writeFile(join(tmp, 'medium'), 'a'.repeat(50));
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: tmp, sortBy: 'size', sortOrder: 'desc' }))));
    const names = (r.entries as ListEntry[]).map((e) => e.name);
    expect(names).toEqual(['big', 'medium', 'small']);
  });

  it('sorts by modifiedAt asc', async () => {
    const h = makeFileListHandler({ policy: allowPolicy });
    await writeFile(join(tmp, 'old'), 'a');
    await utimes(join(tmp, 'old'), new Date('2024-01-01'), new Date('2024-01-01'));
    await writeFile(join(tmp, 'new'), 'a');
    await utimes(join(tmp, 'new'), new Date('2025-01-01'), new Date('2025-01-01'));
    const r = JSON.parse(await h(ctx(JSON.stringify({ path: tmp, sortBy: 'modifiedAt' }))));
    const names = (r.entries as ListEntry[]).map((e) => e.name);
    expect(names).toEqual(['old', 'new']);
  });

  it('returns policy denial reason on read deny', async () => {
    const deny = { check: () => ({ decision: 'deny' as const, reason: 'access denied' }) };
    const h = makeFileListHandler({ policy: deny });
    expect(JSON.parse(await h(ctx(JSON.stringify({ path: tmp })))).error).toBe('access denied');
  });
});
