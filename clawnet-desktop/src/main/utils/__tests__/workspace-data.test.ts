import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  setWorkspaceRootHint,
  clearWorkspaceRootHints,
  findWorkspaceRoot,
  clawnetDir,
  trashDir,
  generateTrashId,
  ensureDirectory,
} from '../workspace-data';

let root: string;

beforeEach(() => {
  clearWorkspaceRootHints();
  root = mkdtempSync(join(tmpdir(), 'workspace-data-'));
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('findWorkspaceRoot', () => {
  it('returns the hint when target is under a registered hint', async () => {
    setWorkspaceRootHint(root);
    const ws = await findWorkspaceRoot(join(root, 'sub', 'file.txt'), { fileAccess: null });
    expect(ws).toBe(root);
  });

  it('picks the longest matching hint', async () => {
    const inner = join(root, 'inner');
    mkdirSync(inner);
    setWorkspaceRootHint(root);
    setWorkspaceRootHint(inner);
    const ws = await findWorkspaceRoot(join(inner, 'deep', 'file.txt'), { fileAccess: null });
    expect(ws).toBe(inner);
  });

  it('falls back to .clawnet ancestor walk', async () => {
    const wsRoot = join(root, 'project');
    mkdirSync(wsRoot);
    mkdirSync(join(wsRoot, '.clawnet'));
    mkdirSync(join(wsRoot, 'src'));
    const ws = await findWorkspaceRoot(join(wsRoot, 'src', 'file.ts'), { fileAccess: null });
    expect(ws).toBe(wsRoot);
  });

  it('falls back to fileAccess.allowedPaths when no hint and no .clawnet', async () => {
    const allowed = join(root, 'workspace');
    mkdirSync(allowed);
    const ws = await findWorkspaceRoot(
      join(allowed, 'a', 'b.txt'),
      { fileAccess: { allowedPaths: [allowed] } },
    );
    expect(ws).toBe(allowed);
  });

  it('skips fileAccess entries with glob chars', async () => {
    const ws = await findWorkspaceRoot(
      join(root, 'x', 'y.txt'),
      { fileAccess: { allowedPaths: [join(root, '*'), join(root, 'noglob')] } },
    );
    expect(ws).toBeNull();
  });

  it('returns null when nothing matches', async () => {
    const ws = await findWorkspaceRoot('/nowhere/file.txt', { fileAccess: null });
    expect(ws).toBeNull();
  });

  // Step 4: BookmarkStore — paths granted via the consent UI flow.
  // Without this, a user who clicked "Allow" on a consent prompt for a path
  // outside fileAccess.allowedPaths gets NO_WORKSPACE on file.trash etc.
  it('returns longest matching bookmark path when no other step matches', async () => {
    const bookmarks = {
      list: () => [
        { path: join(root, 'docs'), addedAt: '', grantedTo: ['all'] },
        { path: join(root, 'docs', 'reports'), addedAt: '', grantedTo: ['all'] },
      ],
    };
    const ws = await findWorkspaceRoot(
      join(root, 'docs', 'reports', 'q1', 'x.txt'),
      { fileAccess: null, bookmarks },
    );
    expect(ws).toBe(join(root, 'docs', 'reports'));
  });

  it('fileAccess.allowedPaths wins over bookmark when both match (Step 3 before Step 4)', async () => {
    const allowed = join(root, 'allowed');
    const bookmarks = { list: () => [{ path: join(root, 'bm'), addedAt: '', grantedTo: ['all'] }] };
    const wsAllow = await findWorkspaceRoot(
      join(allowed, 'a.txt'),
      { fileAccess: { allowedPaths: [allowed] }, bookmarks },
    );
    expect(wsAllow).toBe(allowed);
    const wsBm = await findWorkspaceRoot(
      join(root, 'bm', 'b.txt'),
      { fileAccess: { allowedPaths: [allowed] }, bookmarks },
    );
    expect(wsBm).toBe(join(root, 'bm'));
  });
});

describe('clawnetDir / trashDir', () => {
  it('clawnetDir appends .clawnet', () => {
    expect(clawnetDir('/x/y')).toMatch(/[/\\]\.clawnet$/);
  });
  it('trashDir appends .clawnet/trash', () => {
    expect(trashDir('/x/y')).toMatch(/[/\\]\.clawnet[/\\]trash$/);
  });
});

describe('generateTrashId', () => {
  it('format yyyyMMdd_HHmmss_<4hex>', () => {
    const id = generateTrashId(new Date('2026-05-13T07:08:09Z'));
    expect(id).toMatch(/^20260513_070809_[0-9a-f]{4}$/);
  });
  it('produces different IDs back-to-back', () => {
    const a = generateTrashId();
    const b = generateTrashId();
    expect(a).not.toBe(b);
  });
});

describe('ensureDirectory', () => {
  it('creates the directory tree if missing', async () => {
    const dir = join(root, 'a', 'b', 'c');
    await ensureDirectory(dir);
    await ensureDirectory(dir);
    writeFileSync(join(dir, 'probe'), 'x');
  });
});

import { logsDir, snapshotsDir } from '../workspace-data';

describe('logsDir', () => {
  it('returns <wsRoot>/.clawnet/logs', () => {
    expect(logsDir('/ws')).toBe(join(clawnetDir('/ws'), 'logs'));
  });
});

describe('snapshotsDir', () => {
  it('returns <wsRoot>/.clawnet/snapshots', () => {
    expect(snapshotsDir('/ws')).toBe(join(clawnetDir('/ws'), 'snapshots'));
  });
});
