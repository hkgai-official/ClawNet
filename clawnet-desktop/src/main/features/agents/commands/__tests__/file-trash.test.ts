import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeFileTrashHandler, restoreFromTrash } from '../file-trash';
import { clearWorkspaceRootHints, setWorkspaceRootHint, trashDir } from '../../../../utils/workspace-data';
import { serializeTrashMeta } from '../../../../../shared/domain/trash';

type Policy = {
  check: ReturnType<typeof vi.fn>;
};

let wsRoot: string;
let policy: Policy;
let fileAccess: { getEffectiveSettings: () => { allowedPaths: string[] } | null };

beforeEach(() => {
  clearWorkspaceRootHints();
  wsRoot = mkdtempSync(join(tmpdir(), 'file-trash-test-'));
  policy = {
    check: vi.fn().mockReturnValue({ decision: 'allow', reason: 'ok' }),
  };
  fileAccess = { getEffectiveSettings: () => ({ allowedPaths: [wsRoot] }) };
  setWorkspaceRootHint(wsRoot);
});

afterEach(() => { rmSync(wsRoot, { recursive: true, force: true }); });

function makeCtx(overrides: { paramsJSON?: string } = {}) {
  const ctx: { invokeId: string; paramsJSON?: string; workspaceRoot?: string; tagNodeAcl?: unknown } = {
    invokeId: 'invoke-1',
  };
  if (overrides.paramsJSON !== undefined) ctx.paramsJSON = overrides.paramsJSON;
  return ctx;
}

describe('makeFileTrashHandler', () => {
  it('returns errorJSON when path missing', async () => {
    const handler = makeFileTrashHandler({ policy, fileAccess });
    const r = await handler(makeCtx({ paramsJSON: '{}' }));
    expect(JSON.parse(r).error).toMatch(/missing path/);
  });

  it('returns errorJSON when paramsJSON is malformed', async () => {
    const handler = makeFileTrashHandler({ policy, fileAccess });
    const r = await handler(makeCtx({ paramsJSON: 'nope' }));
    expect(JSON.parse(r).error).toMatch(/invalid params|missing path/);
  });

  it('returns errorJSON when read policy denies', async () => {
    const target = join(wsRoot, 'a.txt');
    writeFileSync(target, 'hi');
    policy.check.mockReturnValueOnce({ decision: 'deny', reason: 'server-denied' });
    const handler = makeFileTrashHandler({ policy, fileAccess });
    const r = await handler(makeCtx({ paramsJSON: JSON.stringify({ path: target }) }));
    expect(JSON.parse(r).error).toMatch(/server-denied/);
  });

  it('returns errorJSON when write policy denies (read OK)', async () => {
    const target = join(wsRoot, 'a.txt');
    writeFileSync(target, 'hi');
    policy.check
      .mockReturnValueOnce({ decision: 'allow', reason: 'ok' })
      .mockReturnValueOnce({ decision: 'deny', reason: 'write-denied' });
    const handler = makeFileTrashHandler({ policy, fileAccess });
    const r = await handler(makeCtx({ paramsJSON: JSON.stringify({ path: target }) }));
    expect(JSON.parse(r).error).toMatch(/write-denied/);
  });

  it('returns NOT_FOUND when path does not exist', async () => {
    const handler = makeFileTrashHandler({ policy, fileAccess });
    const r = await handler(makeCtx({ paramsJSON: JSON.stringify({ path: join(wsRoot, 'gone.txt') }) }));
    expect(JSON.parse(r).error).toMatch(/NOT_FOUND/);
  });

  it('returns NO_WORKSPACE when workspace cannot be found', async () => {
    clearWorkspaceRootHints();
    fileAccess.getEffectiveSettings = () => null;
    const target = join(wsRoot, 'a.txt');
    writeFileSync(target, 'hi');
    const handler = makeFileTrashHandler({ policy, fileAccess });
    const r = await handler(makeCtx({ paramsJSON: JSON.stringify({ path: target }) }));
    expect(JSON.parse(r).error).toMatch(/NO_WORKSPACE/);
  });

  it('successfully moves file into .clawnet/trash/<id>/ and writes _meta.json', async () => {
    const target = join(wsRoot, 'invoice-2025.pdf');
    writeFileSync(target, 'pdf bytes');
    const handler = makeFileTrashHandler({ policy, fileAccess });
    const r = await handler(makeCtx({ paramsJSON: JSON.stringify({ path: target }) }));
    const parsed = JSON.parse(r);
    expect(parsed.error).toBeUndefined();
    expect(parsed.path).toBe(target);
    expect(parsed.trashId).toMatch(/^\d{8}_\d{6}_[0-9a-f]{4}$/);

    expect(existsSync(target)).toBe(false);

    const entryDir = join(wsRoot, '.clawnet', 'trash', parsed.trashId);
    expect(existsSync(entryDir)).toBe(true);
    const meta = JSON.parse(readFileSync(join(entryDir, '_meta.json'), 'utf-8'));
    expect(meta.original_path).toBe(target);
    expect(typeof meta.trashed_at).toBe('number');
    expect(meta.session_id).toBeNull();

    expect(existsSync(join(entryDir, 'invoice-2025.pdf'))).toBe(true);
    expect(readFileSync(join(entryDir, 'invoice-2025.pdf'), 'utf-8')).toBe('pdf bytes');
  });

  it('cleans up trash entry directory when ensureDirectory/rename fails', async () => {
    const target = join(wsRoot, 'src.txt');
    writeFileSync(target, 'x');
    // Block trash creation: place a regular file at <wsRoot>/.clawnet/trash so
    // ensureDirectory(<wsRoot>/.clawnet/trash/<id>) fails with ENOTDIR. The
    // cleanup rm() then runs against entryDir (which never existed) — best-effort.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(wsRoot, '.clawnet'), { recursive: true });
    writeFileSync(join(wsRoot, '.clawnet', 'trash'), 'not a dir');

    const handler = makeFileTrashHandler({ policy, fileAccess });
    const r = await handler(makeCtx({ paramsJSON: JSON.stringify({ path: target }) }));
    expect(JSON.parse(r).error).toMatch(/trash failed/);

    // Source must still exist (rename never ran).
    expect(existsSync(target)).toBe(true);

    // No trash entry subdirs were left behind beneath the (file-typed) trash path.
    const trashStat = (await import('node:fs/promises')).stat(join(wsRoot, '.clawnet', 'trash'));
    expect((await trashStat).isFile()).toBe(true);
  });

  // Integration: bookmark-only path (the new Step 4 in findWorkspaceRoot).
  // Reproduces the case that previously returned NO_WORKSPACE before the fix.
  it('succeeds when wsRoot is reachable only via BookmarkStore (no hint, no .clawnet/, no fileAccess match)', async () => {
    // Use a fresh dir that is NOT registered as a hint and is NOT under
    // fileAccess.allowedPaths.  Only a BookmarkStore-like dep grants it.
    const bmRoot = mkdtempSync(join(tmpdir(), 'file-trash-bm-'));
    try {
      const target = join(bmRoot, 'doc.txt');
      writeFileSync(target, 'will-be-trashed');

      // Empty fileAccess + no hint registration means Steps 1-3 all miss.
      const isolatedFileAccess = { getEffectiveSettings: () => ({ allowedPaths: [] as string[] }) };
      clearWorkspaceRootHints();
      const bookmarks = { list: () => [{ path: bmRoot }] };

      const handler = makeFileTrashHandler({
        policy,
        fileAccess: isolatedFileAccess,
        bookmarks,
      });
      const r = JSON.parse(await handler(makeCtx({
        paramsJSON: JSON.stringify({ path: target }),
      })));
      expect(r.error).toBeUndefined();
      expect(r.path).toBe(target);
      expect(r.trashId).toMatch(/^\d{8}_\d{6}_[0-9a-f]{4}$/);
      // Verify the file is now under <bmRoot>/.clawnet/trash/<trashId>/
      expect(existsSync(target)).toBe(false);
      expect(existsSync(join(trashDir(bmRoot), r.trashId, 'doc.txt'))).toBe(true);
    } finally {
      rmSync(bmRoot, { recursive: true, force: true });
    }
  });

  it('returns NO_WORKSPACE when bookmark-only path is provided WITHOUT bookmarks dep (regression guard)', async () => {
    const isolatedRoot = mkdtempSync(join(tmpdir(), 'file-trash-isolated-'));
    try {
      const target = join(isolatedRoot, 'doc.txt');
      writeFileSync(target, 'orphan');
      const isolatedFileAccess = { getEffectiveSettings: () => ({ allowedPaths: [] as string[] }) };
      clearWorkspaceRootHints();

      // No bookmarks dep — should fall through Steps 1-3-4 with all misses.
      const handler = makeFileTrashHandler({ policy, fileAccess: isolatedFileAccess });
      const r = JSON.parse(await handler(makeCtx({
        paramsJSON: JSON.stringify({ path: target }),
      })));
      expect(r.error).toMatch(/NO_WORKSPACE/);
    } finally {
      rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });
});

describe('restoreFromTrash', () => {
  let ws: string;
  beforeEach(async () => { ws = await mkdtemp(join(tmpdir(), 'restore-')); });
  afterEach(async () => { await rm(ws, { recursive: true, force: true }); });

  it('moves trashed file back to originalPath', async () => {
    const originalPath = join(ws, 'doc.txt');
    const trashId = '20260513_120000_aaaa';
    const entryDir = join(trashDir(ws), trashId);
    await mkdir(entryDir, { recursive: true });
    await writeFile(join(entryDir, '_meta.json'), serializeTrashMeta({
      originalPath,
      trashedAt: Date.now(),
      sessionId: null,
    }), 'utf-8');
    await writeFile(join(entryDir, 'doc.txt'), 'restored-content');

    await restoreFromTrash(trashId, ws);
    expect(await readFile(originalPath, 'utf-8')).toBe('restored-content');
    await expect(stat(entryDir)).rejects.toBeDefined();
  });

  it('throws when trash entry directory is missing', async () => {
    await expect(restoreFromTrash('20260101_120000_zzzz', ws)).rejects.toThrow();
  });

  it('throws when _meta.json is malformed', async () => {
    const trashId = '20260513_120000_bbbb';
    const entryDir = join(trashDir(ws), trashId);
    await mkdir(entryDir, { recursive: true });
    await writeFile(join(entryDir, '_meta.json'), 'not-json', 'utf-8');
    await expect(restoreFromTrash(trashId, ws)).rejects.toThrow();
  });

  it('throws when originalPath is already occupied', async () => {
    const originalPath = join(ws, 'collide.txt');
    await writeFile(originalPath, 'occupied');
    const trashId = '20260513_120000_cccc';
    const entryDir = join(trashDir(ws), trashId);
    await mkdir(entryDir, { recursive: true });
    await writeFile(join(entryDir, '_meta.json'), serializeTrashMeta({
      originalPath,
      trashedAt: Date.now(),
      sessionId: null,
    }), 'utf-8');
    await writeFile(join(entryDir, 'collide.txt'), 'restored');
    await expect(restoreFromTrash(trashId, ws)).rejects.toThrow(/CONFLICT/);
  });
});
