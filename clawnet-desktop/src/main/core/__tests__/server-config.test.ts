import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadServerConfig, DEFAULT_SERVER_URL } from '../server-config';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'clawnet-test-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('loadServerConfig', () => {
  it('returns default when file is missing', () => {
    expect(loadServerConfig(join(tmp, 'absent.json'))).toBe(DEFAULT_SERVER_URL);
  });

  it('returns serverURL from valid file', () => {
    const p = join(tmp, 'sc.json');
    writeFileSync(p, JSON.stringify({ serverURL: 'http://x.test:9999' }));
    expect(loadServerConfig(p)).toBe('http://x.test:9999');
  });

  it('returns default when file is malformed JSON', () => {
    const p = join(tmp, 'bad.json');
    writeFileSync(p, 'not json');
    expect(loadServerConfig(p)).toBe(DEFAULT_SERVER_URL);
  });

  it('returns default when serverURL is missing in file', () => {
    const p = join(tmp, 'missing.json');
    writeFileSync(p, JSON.stringify({ other: 'x' }));
    expect(loadServerConfig(p)).toBe(DEFAULT_SERVER_URL);
  });

  it('returns default when serverURL is empty string', () => {
    const p = join(tmp, 'empty.json');
    writeFileSync(p, JSON.stringify({ serverURL: '' }));
    expect(loadServerConfig(p)).toBe(DEFAULT_SERVER_URL);
  });
});
