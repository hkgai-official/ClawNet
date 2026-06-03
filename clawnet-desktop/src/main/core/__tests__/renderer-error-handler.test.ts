import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleRendererError } from '../renderer-error-handler';

describe('handleRendererError', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'rerr-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('writes a renderer error event to the crash log', async () => {
    handleRendererError(dir, { kind: 'error', message: 'ReferenceError: foo is not defined', stack: 'at App (App.tsx:42)' });
    const files = await readdir(dir);
    const crashFile = files.find((f) => f.startsWith('crash-'));
    expect(crashFile).toBeDefined();
    const content = await readFile(join(dir, crashFile!), 'utf-8');
    expect(content).toContain('rendererError');
    expect(content).toContain('ReferenceError: foo is not defined');
  });

  it('handles minimal payloads without throwing', () => {
    expect(() => handleRendererError(dir, { kind: 'unhandledrejection' })).not.toThrow();
  });

  it('serializes unhandledrejection reason as string', async () => {
    handleRendererError(dir, { kind: 'unhandledrejection', reason: 'Promise rejected: timeout' });
    const files = await readdir(dir);
    const crashFile = files.find((f) => f.startsWith('crash-'));
    const content = await readFile(join(dir, crashFile!), 'utf-8');
    expect(content).toContain('Promise rejected: timeout');
  });
});
