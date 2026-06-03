// e2e/19-file-search-roundtrip.spec.ts
//
// P3C-agent-exec-FileSearch: the round-trip equivalent of spec 18, but
// against the real `file.search` handler (`makeFileSearchHandler`) wired
// from main/index.ts. Builds a real tmp corpus on disk, pushes a
// `node.invoke.request` for `file.search`, and asserts the
// `node.invoke.result` frame carries back actual file hits.
//
// Two-layer policy gating, both of which must allow the scanRoot:
//
//   1. Global `CommandPolicy.check` runs first inside `checkWithTagAcl`
//      and requires the path to be in the local BookmarkStore (or for
//      server-side `mode: 'full'` to be cached — but the post-auth
//      `syncFromServer` is fire-and-forget and races our push). We seed
//      `file_access.json` directly so the bookmark gate is satisfied
//      synchronously at app boot.
//
//   2. Tag-ACL `checkWithTagAcl` then intersects with the per-push
//      `tagNodeAcl` payload. Sending `{allowedPaths:[scanRoot]}` exercises
//      the tag-allowed branch (CommandPolicy.swift:96-141) — the demo
//      value of this phase: the bookmark proves the user once consented
//      to the dir, the tag-ACL proves the agent's tag is currently
//      authorised for it.

import { test, expect, request as pwRequest } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let server: FakeServer;
let app: LaunchResult;
let scanRoot: string | null = null;

test.beforeEach(async () => {
  // Build the search corpus first — its absolute path goes into both the
  // bookmark seed AND the push's tagNodeAcl, so it must exist before
  // launchApp creates the userData dir.
  scanRoot = mkdtempSync(join(tmpdir(), 'file-search-e2e-'));
  writeFileSync(
    join(scanRoot, 'quarterly-2026.txt'),
    'revenue numbers go here\nlots of relevant numbers about quarterly performance\n',
  );
  writeFileSync(join(scanRoot, 'unrelated.txt'), 'nothing here\n');

  // Pre-seed file_access.json (BookmarkStore's on-disk schema is
  // `{version:1, entries:[…]}` — see src/main/store/bookmark-store.ts).
  // The bookmark grants `all` agents read access to scanRoot, satisfying
  // CommandPolicy.check's bookmark gate before the renderer's post-auth
  // sync has a chance to populate cached serverSettings.
  const bookmarkSeed = JSON.stringify({
    version: 1,
    entries: [
      {
        path: scanRoot,
        label: 'e2e-file-search-tmp',
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
  if (scanRoot) {
    rmSync(scanRoot, { recursive: true, force: true });
    scanRoot = null;
  }
});

test('file.search push → result with real keyword hits on tmp dir', async () => {
  const { window } = app;
  // scanRoot is created and bookmarked in beforeEach so the userData seed
  // can reference it before the app process starts.
  const root = scanRoot!;

  // --- Sign in (same shape as spec 18) ---
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('tempPass1');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  // --- Push the node.invoke.request for file.search ---
  // tagNodeAcl uses snake_case in transport? No — the WS payload is
  // parsed by NodeInvokePayloadSchema (z.unknown for tagNodeAcl) and then
  // re-parsed inside the file-search handler by NodeAclSchema. The schema
  // expects the macOS-side raw camelCase keys (allowedPaths, deniedPaths,
  // accessMode) verbatim because WS frames bypass the REST snake_case
  // boundary (same convention as the rest of the push pipeline).
  const invokeId = `invoke-${Date.now()}`;
  const ctx = await pwRequest.newContext();
  await ctx.post(`${server.url}/__test/push-node-invoke`, {
    data: {
      id: invokeId,
      command: 'file.search',
      paramsJSON: JSON.stringify({
        path: root,
        keywords: ['quarterly', 'revenue'],
      }),
      tagNodeAcl: {
        allowedPaths: [root],
        deniedPaths: [],
        accessMode: 'rw',
      },
    },
  });

  // --- Poll for the reply (same shape as spec 18) ---
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

  type SearchResult = {
    error?: string;
    basePath?: string;
    count?: number;
    maxResults?: number;
    results?: Array<{
      path: string;
      name: string;
      size: number;
      format: string;
      keywordHits: string[];
      parsed?: boolean;
      text?: string;
    }>;
  };
  const result = JSON.parse(reply!.params!.result!) as SearchResult;

  // If the handler errored, surface the reason in the failure message so
  // the next iteration knows whether to chase ACL vs. fs vs. parse issues.
  expect(result.error, `file.search returned error: ${result.error}`).toBeUndefined();
  expect(result.results, 'no results array on success path').toBeDefined();
  expect(result.results!.length).toBeGreaterThanOrEqual(1);

  const quarterly = result.results!.find((r) => r.path.endsWith('quarterly-2026.txt'));
  expect(quarterly, 'quarterly-2026.txt missing from results').toBeDefined();
  expect(quarterly!.keywordHits).toContain('quarterly');
  expect(quarterly!.keywordHits).toContain('revenue');
  expect(quarterly!.format).toBe('text');

  await ctx.dispose();
});
