import { readFileSync } from 'node:fs';

export const DEFAULT_SERVER_URL = 'http://localhost:9000';

export function loadServerConfig(path: string): string {
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as { serverURL?: unknown };
    if (typeof parsed.serverURL === 'string' && parsed.serverURL.length > 0) {
      return parsed.serverURL;
    }
  } catch {
    // file missing, malformed, or unreadable — fall through to default
  }
  return DEFAULT_SERVER_URL;
}
