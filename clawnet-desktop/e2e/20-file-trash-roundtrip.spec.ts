// e2e/20-file-trash-roundtrip.spec.ts
//
// P3C-agent-exec-FileTrash: real-fs round-trip equivalent of spec 19, but
// for `file.trash`. Builds a real tmp workspace with an `invoice.txt`
// file, pushes a `node.invoke.request` for `file.trash`, then asserts:
//   1. the `node.invoke.result` frame carries back `{path, trashId}`,
//   2. the source file no longer exists on disk,
//   3. `<wsRoot>/.clawnet/trash/<trashId>/_meta.json` exists and parses,
//   4. the moved file lives at `<entryDir>/<basename>` with identical bytes.
//
// Three policy gates have to align:
//
//   - Global `CommandPolicy.check` (read AND write, since file.trash does
//     both) needs the bookmark seed for the tmp dir so the post-auth
//     `/api/v1/file-access/settings` sync race doesn't matter.
//
//   - Dispatch-layer `checkWithTagAcl` in NodeEventHandler is fed via
//     `tagNodeAcl.allowedPaths:[wsRoot]` on the push. This *also* gets
//     handed to `setWorkspaceRootHint` (NodeEventHandler.swift:36-45
//     parity), which is the critical bit — without it,
//     `findWorkspaceRoot` would fail because the fake server's
//     `/api/v1/file-access/settings` returns `allowed_paths:[]` and the
//     tmp dir has no `.clawnet` ancestor.
//
//   - `findWorkspaceRoot` then resolves wsRoot via the hint, and the
//     handler writes to `<wsRoot>/.clawnet/trash/<trashId>/`.

import { test, expect, request as pwRequest } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let server: FakeServer;
let app: LaunchResult;
let wsRoot: string | null = null;

const FILE_CONTENT = 'old invoice content';

test.beforeEach(async () => {
  // Build the workspace BEFORE launchApp so its absolute path can be
  // seeded into `file_access.json` (bookmark gate) and later pushed in
  // `tagNodeAcl.allowedPaths` (hint + dispatch ACL).
  wsRoot = mkdtempSync(join(tmpdir(), 'file-trash-e2e-'));
  writeFileSync(join(wsRoot, 'invoice.txt'), FILE_CONTENT);

  // Bookmark on wsRoot grants policy.check for both read and write since
  // BookmarkStore.isAllowed treats any descendant as covered.
  const bookmarkSeed = JSON.stringify({
    version: 1,
    entries: [
      {
        path: wsRoot,
        label: 'e2e-file-trash-tmp',
        addedAt: new Date().toISOString(),
        grantedTo: ['all'],
      },
    ],
  });

  server = await startFakeServer();
  app = await launchApp({
    serverURL: server.url,
    seedUserData: { 'file_access.json': bookmarkSeed },
  });
});

test.afterEach(async () => {
  await app.close();
  await server.close();
  if (wsRoot) {
    rmSync(wsRoot, { recursive: true, force: true });
    wsRoot = null;
  }
});

test('file.trash push → result moves file into .clawnet/trash/<trashId>/', async () => {
  const { window } = app;
  const root = wsRoot!;
  const targetFile = join(root, 'invoice.txt');

  // --- Sign in (same shape as spec 19) ---
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('tempPass1');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  // --- Push the node.invoke.request for file.trash ---
  // tagNodeAcl.allowedPaths serves two roles here:
  //   1. dispatch-layer `checkWithTagAcl` allow,
  //   2. seed `setWorkspaceRootHint` so `findWorkspaceRoot` resolves
  //      wsRoot without depending on `/api/v1/file-access/settings`.
  const invokeId = `invoke-${Date.now()}`;
  const ctx = await pwRequest.newContext();
  await ctx.post(`${server.url}/__test/push-node-invoke`, {
    data: {
      id: invokeId,
      command: 'file.trash',
      paramsJSON: JSON.stringify({ path: targetFile }),
      tagNodeAcl: {
        allowedPaths: [root],
        deniedPaths: [],
        accessMode: 'rw',
      },
    },
  });

  // --- Poll for the reply ---
  type Frame = {
    type?: string;
    method?: string;
    params?: { id?: string; result?: string };
  };
  let reply: Frame | undefined;
  let lastFrames: Frame[] = [];
  for (let i = 0; i < 50; i++) {
    const res = await ctx.get(`${server.url}/__test/received-frames`);
    lastFrames = (await res.json()) as Frame[];
    reply = lastFrames.find(
      (f) =>
        f.type === 'request' &&
        f.method === 'node.invoke.result' &&
        f.params?.id === invokeId,
    );
    if (reply) break;
    await window.waitForTimeout(100);
  }

  expect(
    reply,
    `Expected node.invoke.result frame for ${invokeId}. Frames seen: ${JSON.stringify(lastFrames)}`,
  ).toBeTruthy();
  expect(reply?.params?.result).toBeTruthy();

  type TrashResult = { error?: string; path?: string; trashId?: string };
  const result = JSON.parse(reply!.params!.result!) as TrashResult;

  expect(result.error, `file.trash returned error: ${result.error}`).toBeUndefined();
  expect(result.path).toBe(targetFile);
  expect(result.trashId).toMatch(/^\d{8}_\d{6}_[0-9a-f]{4}$/);

  // --- Assert disk side-effects ---
  expect(existsSync(targetFile), 'source file should be moved away').toBe(false);

  const entryDir = join(root, '.clawnet', 'trash', result.trashId!);
  expect(existsSync(entryDir), `trash entry dir missing: ${entryDir}`).toBe(true);

  const metaPath = join(entryDir, '_meta.json');
  expect(existsSync(metaPath), '_meta.json missing in trash entry').toBe(true);

  const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as Record<string, unknown>;
  // Snake-case wire shape — see src/shared/domain/trash.ts:
  //   { original_path, trashed_at, session_id }
  expect(meta.original_path).toBe(targetFile);
  expect(typeof meta.trashed_at).toBe('number');
  expect(meta.session_id).toBeNull();

  const movedFile = join(entryDir, 'invoice.txt');
  expect(existsSync(movedFile), 'moved file missing in trash entry').toBe(true);
  expect(readFileSync(movedFile, 'utf-8')).toBe(FILE_CONTENT);

  await ctx.dispose();
});
