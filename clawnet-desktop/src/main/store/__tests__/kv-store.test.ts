import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getName: () => 'clawnet', getVersion: () => '0.1.0' },
  ipcMain: null,
  shell: {},
  default: {
    ipcRenderer: null,
  },
}));

import { createKvStore } from '../kv-store';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'clawnet-kv-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('createKvStore', () => {
  it('persists and reads back values across instances', () => {
    const store1 = createKvStore({ cwd: tmp, name: 'prefs' });
    store1.set('theme', 'dark');
    const store2 = createKvStore({ cwd: tmp, name: 'prefs' });
    expect(store2.get('theme')).toBe('dark');
  });

  it('returns undefined for missing keys', () => {
    const store = createKvStore({ cwd: tmp, name: 'prefs' });
    expect(store.get('absent')).toBeUndefined();
  });

  it('delete() removes a key', () => {
    const store = createKvStore({ cwd: tmp, name: 'prefs' });
    store.set('x', 1);
    store.delete('x');
    expect(store.get('x')).toBeUndefined();
  });

  it('clear() removes all keys in this namespace', () => {
    const store = createKvStore({ cwd: tmp, name: 'prefs' });
    store.set('a', 1);
    store.set('b', 2);
    store.clear();
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toBeUndefined();
  });
});
