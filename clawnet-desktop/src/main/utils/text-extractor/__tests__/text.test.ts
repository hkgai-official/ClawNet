import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractTextFile } from '../text';

let root: string;
let smallTxt: string;
let largeTxt: string;
let binaryFile: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'text-extractor-'));
  smallTxt = join(root, 'small.txt');
  writeFileSync(smallTxt, 'hello quarterly world');
  largeTxt = join(root, 'large.txt');
  writeFileSync(largeTxt, 'A'.repeat(600 * 1024) + 'TAIL');
  binaryFile = join(root, 'blob.bin');
  writeFileSync(binaryFile, Buffer.from([0xff, 0xfe, 0xfd, 0x00, 0x01, 0x02]));
});

afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('extractTextFile', () => {
  it('returns full text for small files (≤ 512 KB)', async () => {
    const r = await extractTextFile(smallTxt, 22);
    expect(r.format).toBe('text');
    expect(r.text).toContain('quarterly');
  });

  it('returns head + tail for large files', async () => {
    const r = await extractTextFile(largeTxt, 600 * 1024 + 4);
    expect(r.format).toBe('text');
    expect(r.text).toMatch(/^A+/);
    expect(r.text).toMatch(/TAIL$/);
  });

  it('returns null + format=binary for non-UTF-8 content', async () => {
    const r = await extractTextFile(binaryFile, 6);
    expect(r.text).toBeNull();
    expect(r.format).toBe('binary');
  });
});
