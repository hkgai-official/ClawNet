import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractRtfdFile } from '../rtfd';

let bundleDir: string;
let parent: string;

beforeAll(() => {
  parent = mkdtempSync(join(tmpdir(), 'rtfd-test-'));
  bundleDir = join(parent, 'sample.rtfd');
  mkdirSync(bundleDir);
  // .rtfd bundle conventionally contains TXT.rtf
  writeFileSync(join(bundleDir, 'TXT.rtf'), '{\\rtf1\\ansi quarterly}');
});

describe('extractRtfdFile', () => {
  it('finds TXT.rtf inside the bundle dir and delegates to extractRtfFile', async () => {
    const r = await extractRtfdFile(bundleDir, 100);
    expect(r.format).toBe('rtfd');
    expect(r.text).not.toBeNull();
  });

  it('returns null when bundle is missing TXT.rtf', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'rtfd-empty-'));
    const r = await extractRtfdFile(empty, 100);
    expect(r.text).toBeNull();
    expect(r.format).toBe('rtfd');
    rmSync(empty, { recursive: true, force: true });
  });
});
