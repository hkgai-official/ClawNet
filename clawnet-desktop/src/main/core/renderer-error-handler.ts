import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RendererErrorPayload {
  kind: 'error' | 'unhandledrejection';
  message?: string;
  stack?: string;
  reason?: string;
  filename?: string;
  lineno?: number;
}

function crashFileName(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  return `crash-${iso}.log`;
}

function serialize(payload: RendererErrorPayload): string {
  const parts: string[] = [];
  if (payload.message) parts.push(`message: ${payload.message}`);
  if (payload.reason) parts.push(`reason: ${payload.reason}`);
  if (payload.filename) parts.push(`file: ${payload.filename}:${payload.lineno ?? ''}`);
  if (payload.stack) parts.push(`stack: ${payload.stack}`);
  return parts.join('\n');
}

export function handleRendererError(logsDir: string, payload: RendererErrorPayload): void {
  try {
    mkdirSync(logsDir, { recursive: true });
    const entry = `[${new Date().toISOString()}] rendererError (${payload.kind})\n${serialize(payload)}\n\n`;
    appendFileSync(join(logsDir, crashFileName()), entry, 'utf-8');
  } catch {
    // best-effort
  }
}
