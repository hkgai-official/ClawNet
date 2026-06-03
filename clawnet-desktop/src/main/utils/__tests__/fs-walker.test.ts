import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { walkFiles } from '../fs-walker';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'fs-walker-test-'));
  // Build a tree:
  //   <root>/
  //     a.txt (10 bytes)
  //     subdir/
  //       b.txt
  //       deep/
  //         c.txt
  //         deeper/
  //           d.txt
  //     node_modules/                 ← skipped
  //       skipme.txt
  //     My App.app/                   ← bundle ext, skipped
  //       Contents/info.txt
  writeFileSync(join(root, 'a.txt'), 'hello a   ');
  mkdirSync(join(root, 'subdir'));
  writeFileSync(join(root, 'subdir', 'b.txt'), 'hello b');
  mkdirSync(join(root, 'subdir', 'deep'));
  writeFileSync(join(root, 'subdir', 'deep', 'c.txt'), 'hello c');
  mkdirSync(join(root, 'subdir', 'deep', 'deeper'));
  writeFileSync(join(root, 'subdir', 'deep', 'deeper', 'd.txt'), 'hello d');
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'node_modules', 'skipme.txt'), 'no');
  mkdirSync(join(root, 'My App.app'));
  mkdirSync(join(root, 'My App.app', 'Contents'));
  writeFileSync(join(root, 'My App.app', 'Contents', 'info.txt'), 'no');
});

afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('walkFiles', () => {
  it('returns files at depth 0 only', async () => {
    const files = await walkFiles(root, { maxDepth: 0, maxFilesToScan: 1000 });
    const names = files.map((f) => f.path.split(/[/\\]/).pop()).sort();
    expect(names).toEqual(['a.txt']);
  });

  it('includes files at depth 1 when maxDepth=1', async () => {
    const files = await walkFiles(root, { maxDepth: 1, maxFilesToScan: 1000 });
    const names = files.map((f) => f.path.split(/[/\\]/).pop()).sort();
    expect(names).toEqual(['a.txt', 'b.txt']);
  });

  it('recurses to depth 3 (root → subdir → deep → deeper)', async () => {
    const files = await walkFiles(root, { maxDepth: 3, maxFilesToScan: 1000 });
    const names = files.map((f) => f.path.split(/[/\\]/).pop()).sort();
    expect(names).toEqual(['a.txt', 'b.txt', 'c.txt', 'd.txt']);
  });

  it('skips node_modules directory', async () => {
    const files = await walkFiles(root, { maxDepth: 5, maxFilesToScan: 1000 });
    expect(files.some((f) => f.path.includes('node_modules'))).toBe(false);
  });

  it('skips entries whose extension is a bundle (.app)', async () => {
    const files = await walkFiles(root, { maxDepth: 5, maxFilesToScan: 1000 });
    expect(files.some((f) => f.path.includes('My App.app'))).toBe(false);
  });

  it('caps at maxFilesToScan', async () => {
    const files = await walkFiles(root, { maxDepth: 5, maxFilesToScan: 2 });
    expect(files).toHaveLength(2);
  });

  it('records file size in bytes', async () => {
    const files = await walkFiles(root, { maxDepth: 0, maxFilesToScan: 1000 });
    expect(files[0]?.size).toBe(10); // 'hello a   ' is 10 chars
  });
});
