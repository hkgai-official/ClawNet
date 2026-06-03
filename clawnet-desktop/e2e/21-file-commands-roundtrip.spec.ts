// e2e/21-file-commands-roundtrip.spec.ts
//
// P3C-agent-exec-NodeEvent: exercises all 8 file.* command handlers via
// real node.invoke.request push events through the built Electron bundle.
//
// Test flow per command:
//   1. Push a `node.invoke.request` frame via `POST /__test/push-node-invoke`.
//   2. Poll `GET /__test/received-frames` for the matching `node.invoke.result`.
//   3. Assert reply JSON + actual disk state.
//
// Policy gates (same structure as spec 20 / file.trash):
//   - BookmarkStore: `file_access.json` seeded with wsRoot so policy.check
//     passes the read+write bookmark gate for any descendant path.
//   - Dispatch-layer `checkWithTagAcl`: `tagNodeAcl.allowedPaths:[wsRoot]`
//     included in each push payload.
//   - `findWorkspaceRoot`: resolved via `setWorkspaceRootHint` (sent as
//     `tagNodeAcl.allowedPaths[0]`), so it doesn't depend on the REST
//     file-access settings race.

import { test, expect, request as pwRequest } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let server: FakeServer;
let app: LaunchResult;
let wsRoot: string;

test.beforeEach(async () => {
  // Build workspace BEFORE launchApp so the absolute path can be seeded
  // into file_access.json (bookmark gate).
  wsRoot = mkdtempSync(join(tmpdir(), 'file-cmds-e2e-'));
  // .clawnet dir makes findWorkspaceRoot resolve wsRoot via ancestor search
  // (belt-and-suspenders alongside the tagNodeAcl hint).
  mkdirSync(join(wsRoot, '.clawnet'), { recursive: true });

  const bookmarkSeed = JSON.stringify({
    version: 1,
    entries: [
      {
        path: wsRoot,
        label: 'e2e-file-cmds-tmp',
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
  if (wsRoot && existsSync(wsRoot)) {
    rmSync(wsRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helper: push a node.invoke.request and poll for the matching result frame.
// Mirrors the pattern from spec 20 (file.trash) but reusable across commands.
// ---------------------------------------------------------------------------
type Frame = {
  type?: string;
  method?: string;
  params?: { id?: string; result?: string };
};

async function invokeAndWait(
  window: LaunchResult['window'],
  serverUrl: string,
  wsRoot: string,
  command: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const ctx = await pwRequest.newContext();
  const id = `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  try {
    await ctx.post(`${serverUrl}/__test/push-node-invoke`, {
      data: {
        id,
        command,
        paramsJSON: JSON.stringify(params),
        tagNodeAcl: {
          allowedPaths: [wsRoot],
          deniedPaths: [],
          accessMode: 'rw',
        },
      },
    });

    let reply: Frame | undefined;
    let lastFrames: Frame[] = [];
    for (let i = 0; i < 80; i++) {
      const res = await ctx.get(`${serverUrl}/__test/received-frames`);
      lastFrames = (await res.json()) as Frame[];
      reply = lastFrames.find(
        (f) =>
          f.type === 'request' &&
          f.method === 'node.invoke.result' &&
          f.params?.id === id,
      );
      if (reply) break;
      await window.waitForTimeout(100);
    }

    expect(
      reply,
      `Expected node.invoke.result for ${command} (id=${id}). Frames seen: ${JSON.stringify(lastFrames)}`,
    ).toBeTruthy();
    expect(reply?.params?.result, `result field missing for ${command}`).toBeTruthy();

    const parsed = JSON.parse(reply!.params!.result!) as { error?: string } & Record<string, unknown>;
    expect(parsed.error, `${command} returned error: ${parsed.error}`).toBeUndefined();
    return parsed;
  } finally {
    await ctx.dispose();
  }
}

// ---------------------------------------------------------------------------
// Main spec: all 8 file.* commands in one test body to exercise the complete
// handler surface with real filesystem assertions.
// ---------------------------------------------------------------------------
test('file.* command roundtrip via node.invoke.request (P3C-NodeEvent)', async () => {
  const { window } = app;
  const root = wsRoot;

  // --- Sign in ---
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('tempPass1');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  // Wrapper that binds window + server URL + wsRoot for this test run.
  async function invoke(command: string, params: Record<string, unknown>): Promise<unknown> {
    return invokeAndWait(window, server.url, root, command, params);
  }

  // ---------------------------------------------------------------------------
  // 1) file.mkdir — create a subdirectory
  // ---------------------------------------------------------------------------
  const subdir = join(root, 'subdir');
  const mkdirResult = (await invoke('file.mkdir', { path: subdir })) as {
    path: string;
    created: boolean;
  };
  expect(mkdirResult.path).toBe(subdir);
  expect(mkdirResult.created).toBe(true);
  expect((await stat(subdir)).isDirectory()).toBe(true);

  // ---------------------------------------------------------------------------
  // 2) file.write — seed a blob then write it to disk
  // ---------------------------------------------------------------------------
  const writeContent = 'hello world';
  await server.seedBlob({ blobId: 'b-write-1', content: writeContent });
  const writePath = join(subdir, 'hello.txt');
  const writeResult = (await invoke('file.write', {
    path: writePath,
    blobId: 'b-write-1',
  })) as { path: string; bytesWritten: number };
  expect(writeResult.path).toBe(writePath);
  expect(writeResult.bytesWritten).toBe(11);
  expect(await readFile(writePath, 'utf-8')).toBe(writeContent);

  // ---------------------------------------------------------------------------
  // 3) file.stat — stat the written file
  // ---------------------------------------------------------------------------
  const statResult = (await invoke('file.stat', { path: writePath })) as {
    type: string;
    size: number;
    readable: boolean;
  };
  expect(statResult.type).toBe('file');
  expect(statResult.size).toBe(11);
  expect(statResult.readable).toBe(true);

  // ---------------------------------------------------------------------------
  // 4) file.read — read file back, verify via fake-server blob store
  // ---------------------------------------------------------------------------
  const readResult = (await invoke('file.read', { path: writePath })) as {
    blobId: string;
    encoding: string;
    size: number;
    bytesRead: number;
  };
  expect(readResult.encoding).toBe('utf8');
  expect(readResult.bytesRead).toBe(11);
  const readBlob = await server.fetchBlob(readResult.blobId);
  expect(readBlob.toString('utf-8')).toBe(writeContent);

  // ---------------------------------------------------------------------------
  // 5) file.list — list the workspace root (expect only 'subdir', not .clawnet)
  // ---------------------------------------------------------------------------
  const listResult = (await invoke('file.list', { path: root })) as {
    entries: Array<{ name: string }>;
    count: number;
  };
  const names = listResult.entries.map((e) => e.name).sort();
  // .clawnet should be filtered out by the handler
  expect(names).toContain('subdir');
  expect(names).not.toContain('.clawnet');

  // ---------------------------------------------------------------------------
  // 6) file.copy — copy the file into an archive subdirectory
  // ---------------------------------------------------------------------------
  const archiveDir = join(root, 'archive');
  await mkdir(archiveDir, { recursive: true });
  const copyDest = join(archiveDir, 'copy.txt');
  const copyResult = (await invoke('file.copy', {
    source: writePath,
    destination: copyDest,
  })) as { source: string; destination?: string };
  expect(copyResult.source).toBe(writePath);
  expect(await readFile(copyDest, 'utf-8')).toBe(writeContent);

  // ---------------------------------------------------------------------------
  // 7) file.move — move the copy to a new location
  // ---------------------------------------------------------------------------
  const moveDest = join(archiveDir, 'moved.txt');
  const moveResult = (await invoke('file.move', {
    source: copyDest,
    destination: moveDest,
  })) as { source: string; destination?: string };
  expect(moveResult.source).toBe(copyDest);
  expect(existsSync(copyDest)).toBe(false);
  expect((await stat(moveDest)).isFile()).toBe(true);

  // ---------------------------------------------------------------------------
  // 8) file.rename — rename the original file in-place
  // ---------------------------------------------------------------------------
  const renameResult = (await invoke('file.rename', {
    path: writePath,
    newName: 'renamed.txt',
  })) as { oldPath: string; newPath: string };
  expect(renameResult.oldPath).toBe(writePath);
  expect(renameResult.newPath).toBe(join(subdir, 'renamed.txt'));
  expect(existsSync(writePath)).toBe(false);
  expect((await stat(join(subdir, 'renamed.txt'))).isFile()).toBe(true);

  // Final sanity: moved.txt from step 7 still exists
  expect((await stat(moveDest)).isFile()).toBe(true);
});
