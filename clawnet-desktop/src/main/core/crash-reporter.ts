// src/main/core/crash-reporter.ts
//
// Captures uncaught exceptions + unhandled promise rejections to disk so the
// crash is recoverable after the process restarts. Each crash gets its own
// `crash-<iso>.log` file in `logsDir`. The file is created lazily — if no
// crash fires, no file is written.
//
// Wired into main/index.ts right after AppPaths.initialize() so that crashes
// during boot still get captured.
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CrashReporterOptions {
  logsDir: string;
}

function crashFileName(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  return `crash-${iso}.log`;
}

function serializeReason(reason: unknown): string {
  if (reason instanceof Error) return reason.stack ?? reason.message;
  return String(reason);
}

function write(dir: string, kind: string, reason: unknown): void {
  mkdirSync(dir, { recursive: true });
  const entry = `[${new Date().toISOString()}] ${kind}\n${serializeReason(reason)}\n\n`;
  appendFileSync(join(dir, crashFileName()), entry, 'utf-8');
}

export function installCrashReporter(opts: CrashReporterOptions): void {
  process.on('uncaughtException', (err) => {
    write(opts.logsDir, 'uncaughtException', err);
  });
  process.on('unhandledRejection', (reason) => {
    write(opts.logsDir, 'unhandledRejection', reason);
  });
}
