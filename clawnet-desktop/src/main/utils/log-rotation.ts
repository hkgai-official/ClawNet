import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { logsDir } from './workspace-data';

const FILENAME_REGEX = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/;

export async function pruneOldLogs(
  wsRoot: string,
  maxAgeDays: number,
  nowMs: number = Date.now(),
): Promise<number> {
  const dir = logsDir(wsRoot);
  let files: string[];
  try { files = await readdir(dir); } catch { return 0; }
  const cutoffMs = nowMs - maxAgeDays * 24 * 3600 * 1000;
  let removed = 0;
  for (const name of files) {
    const m = FILENAME_REGEX.exec(name);
    if (!m) continue;
    const fileDateMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (fileDateMs < cutoffMs) {
      try { await unlink(join(dir, name)); removed++; } catch { /* ignore */ }
    }
  }
  return removed;
}
