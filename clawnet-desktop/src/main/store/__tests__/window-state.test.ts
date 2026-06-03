import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWindowState, saveWindowState } from '../window-state';

const DEFAULTS = { width: 1280, height: 800 };

describe('loadWindowState', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ws-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('returns defaults when file does not exist', async () => {
    const s = await loadWindowState(dir);
    expect(s).toEqual(DEFAULTS);
  });

  it('returns stored state when file exists', async () => {
    await writeFile(join(dir, 'window-state.json'), JSON.stringify({ x: 100, y: 200, width: 1400, height: 900 }), 'utf-8');
    const s = await loadWindowState(dir);
    expect(s).toEqual({ x: 100, y: 200, width: 1400, height: 900 });
  });

  it('falls back to defaults on corrupt JSON', async () => {
    await writeFile(join(dir, 'window-state.json'), 'not-json', 'utf-8');
    const s = await loadWindowState(dir);
    expect(s).toEqual(DEFAULTS);
  });

  it('falls back to defaults when stored width/height are missing', async () => {
    await writeFile(join(dir, 'window-state.json'), JSON.stringify({ x: 100 }), 'utf-8');
    const s = await loadWindowState(dir);
    expect(s).toEqual(DEFAULTS);
  });
});

describe('saveWindowState', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ws-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('round-trips: save then load returns same bounds', async () => {
    await saveWindowState(dir, { x: 50, y: 60, width: 1500, height: 950 });
    const s = await loadWindowState(dir);
    expect(s).toEqual({ x: 50, y: 60, width: 1500, height: 950 });
  });
});
