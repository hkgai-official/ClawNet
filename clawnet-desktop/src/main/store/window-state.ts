import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

const FILE_NAME = 'window-state.json';
const DEFAULT_STATE: WindowState = { width: 1280, height: 800 };

export async function loadWindowState(userDataDir: string): Promise<WindowState> {
  try {
    const raw = await readFile(join(userDataDir, FILE_NAME), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') {
      return { ...DEFAULT_STATE };
    }
    const out: WindowState = { width: parsed.width, height: parsed.height };
    if (typeof parsed.x === 'number') out.x = parsed.x;
    if (typeof parsed.y === 'number') out.y = parsed.y;
    return out;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function saveWindowState(userDataDir: string, state: WindowState): Promise<void> {
  try {
    await mkdir(userDataDir, { recursive: true });
    await writeFile(join(userDataDir, FILE_NAME), JSON.stringify(state), 'utf-8');
  } catch {
    // ignore
  }
}
