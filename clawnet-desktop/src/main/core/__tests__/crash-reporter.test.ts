import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installCrashReporter } from '../crash-reporter';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cr-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
});

function crashFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.startsWith('crash-'));
}

describe('installCrashReporter', () => {
  it('writes a crash file when an uncaught exception fires', () => {
    installCrashReporter({ logsDir: tmp });
    process.emit('uncaughtException', new Error('oops'));
    const files = crashFiles(tmp);
    expect(files).toHaveLength(1);
    const content = readFileSync(join(tmp, files[0]!), 'utf-8');
    expect(content).toContain('uncaughtException');
    expect(content).toContain('oops');
  });

  it('writes a crash file on unhandled rejection', () => {
    installCrashReporter({ logsDir: tmp });
    // Suppress: we're synthesizing the event ourselves.
    const dummy = Promise.resolve();
    process.emit('unhandledRejection', new Error('rej'), dummy);
    const files = crashFiles(tmp);
    expect(files).toHaveLength(1);
    const content = readFileSync(join(tmp, files[0]!), 'utf-8');
    expect(content).toContain('unhandledRejection');
    expect(content).toContain('rej');
  });

  it('does not write when no error fires', () => {
    installCrashReporter({ logsDir: tmp });
    expect(crashFiles(tmp)).toHaveLength(0);
  });

  it('creates the logs dir if missing', () => {
    const nested = join(tmp, 'logs', 'crash');
    installCrashReporter({ logsDir: nested });
    process.emit('uncaughtException', new Error('boom'));
    expect(crashFiles(nested)).toHaveLength(1);
  });

  it('serializes non-Error reasons via String()', () => {
    installCrashReporter({ logsDir: tmp });
    // Cast: node's typings for emit('unhandledRejection', ...) accept `unknown`
    // reasons via the second overload — passing a plain string exercises the
    // non-Error branch in serializeReason().
    (process.emit as unknown as (e: string, ...args: unknown[]) => boolean)(
      'unhandledRejection',
      'string-rejection',
      Promise.resolve(),
    );
    const files = crashFiles(tmp);
    expect(files).toHaveLength(1);
    const content = readFileSync(join(tmp, files[0]!), 'utf-8');
    expect(content).toContain('string-rejection');
  });
});
