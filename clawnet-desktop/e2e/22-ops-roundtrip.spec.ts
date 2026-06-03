// e2e/22-ops-roundtrip.spec.ts
//
// P3C-Ops: exercises ops.log, ops.undo, and ops.rollback via real
// node.invoke.request push events through the built Electron bundle.
//
// Two scenarios:
//   1. Undo single file.write overwrite: write original → overwrite via blob
//      → ops.log returns operationId → ops.undo restores original from snapshot.
//   2. Session rollback: mkdir + file.write + file.copy → ops.rollback({since:0})
//      undoes all three in reverse-chronological order (copy → write → mkdir).
//
// Policy gates (same structure as spec 21 / file.* roundtrip):
//   - BookmarkStore: `file_access.json` seeded with wsRoot so policy.check
//     passes the read+write bookmark gate for any descendant path.
//   - Dispatch-layer `checkWithTagAcl`: `tagNodeAcl.allowedPaths:[wsRoot]`
//     included in each push payload.
//   - `findWorkspaceRoot`: resolved via `setWorkspaceRootHint` (sent as
//     `tagNodeAcl.allowedPaths[0]`) and the `.clawnet` marker directory.

import { test, expect, request as pwRequest } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helper: push a node.invoke.request and poll for the matching result frame.
// Mirrors the pattern from spec 21 exactly.
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
// Scenario 1: file.write overwrite → ops.undo restores original content
// ---------------------------------------------------------------------------
test('file.write overwrite → ops.undo restores original content (P3C-Ops)', async () => {
  const wsRoot = mkdtempSync(join(tmpdir(), 'ops-undo-e2e-'));
  mkdirSync(join(wsRoot, '.clawnet'), { recursive: true });
  const target = join(wsRoot, 'doc.txt');
  writeFileSync(target, 'ORIGINAL', 'utf-8');

  const bookmarkSeed = JSON.stringify({
    version: 1,
    entries: [
      {
        path: wsRoot,
        label: 'e2e-ops-undo-tmp',
        addedAt: new Date().toISOString(),
        grantedTo: ['all'],
      },
    ],
  });

  const server: FakeServer = await startFakeServer();
  const app = await launchApp({
    serverURL: server.url,
    seedUserData: { 'file_access.json': bookmarkSeed },
  });

  const { window } = app;

  try {
    // Sign in and wait for connection
    await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
    await window.getByLabel(/Password/i).fill('tempPass1');
    await window.getByRole('button', { name: /Sign in/i }).click();
    await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

    async function invoke(command: string, params: Record<string, unknown>): Promise<unknown> {
      return invokeAndWait(window, server.url, wsRoot, command, params);
    }

    // Overwrite the file via blob transfer
    await server.seedBlob({ blobId: 'b-overwrite', content: 'MODIFIED' });
    const wr = (await invoke('file.write', {
      path: target,
      blobId: 'b-overwrite',
    })) as { path: string; bytesWritten: number; operationId: string };

    expect(wr.operationId).toMatch(/^op_/);
    expect(wr.bytesWritten).toBe(8); // 'MODIFIED'.length
    expect(await readFile(target, 'utf-8')).toBe('MODIFIED');

    // ops.log should return at least this one entry
    const lg = (await invoke('ops.log', { path: wsRoot })) as {
      entries: Array<{ id: string; command: string }>;
      total: number;
    };
    expect(lg.total).toBeGreaterThanOrEqual(1);
    const loggedEntry = lg.entries.find((e) => e.id === wr.operationId);
    expect(loggedEntry, `operationId ${wr.operationId} not found in ops.log`).toBeTruthy();
    expect(loggedEntry?.command).toBe('file.write');

    // ops.undo should restore original content from snapshot
    const ud = (await invoke('ops.undo', {
      operationId: wr.operationId,
      path: wsRoot,
    })) as { operationId: string; undone: boolean };

    expect(ud.undone).toBe(true);
    expect(await readFile(target, 'utf-8')).toBe('ORIGINAL');
  } finally {
    await app.close();
    await server.close();
    if (existsSync(wsRoot)) rmSync(wsRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Scenario 2: mkdir + write + copy → ops.rollback undoes all three (DESC)
// ---------------------------------------------------------------------------
test('mkdir + write + copy → ops.rollback undoes all three in reverse order (P3C-Ops)', async () => {
  const wsRoot = mkdtempSync(join(tmpdir(), 'ops-rb-e2e-'));
  mkdirSync(join(wsRoot, '.clawnet'), { recursive: true });
  const subdir = join(wsRoot, 'subdir');

  const bookmarkSeed = JSON.stringify({
    version: 1,
    entries: [
      {
        path: wsRoot,
        label: 'e2e-ops-rb-tmp',
        addedAt: new Date().toISOString(),
        grantedTo: ['all'],
      },
    ],
  });

  const server: FakeServer = await startFakeServer();
  const app = await launchApp({
    serverURL: server.url,
    seedUserData: { 'file_access.json': bookmarkSeed },
  });

  const { window } = app;

  try {
    // Sign in and wait for connection
    await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
    await window.getByLabel(/Password/i).fill('tempPass1');
    await window.getByRole('button', { name: /Sign in/i }).click();
    await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

    async function invoke(command: string, params: Record<string, unknown>): Promise<unknown> {
      return invokeAndWait(window, server.url, wsRoot, command, params);
    }

    // 1. mkdir subdir
    const mkdirResult = (await invoke('file.mkdir', { path: subdir })) as {
      path: string;
      created: boolean;
      operationId: string;
    };
    expect(mkdirResult.created).toBe(true);
    expect((await stat(subdir)).isDirectory()).toBe(true);

    // 2. write doc.txt into subdir
    await server.seedBlob({ blobId: 'b-doc', content: 'doc-content' });
    const writeResult = (await invoke('file.write', {
      path: join(subdir, 'doc.txt'),
      blobId: 'b-doc',
    })) as { path: string; bytesWritten: number; operationId: string };
    expect(writeResult.operationId).toMatch(/^op_/);
    expect(await readFile(join(subdir, 'doc.txt'), 'utf-8')).toBe('doc-content');

    // 3. copy doc.txt → copy.txt
    await invoke('file.copy', {
      source: join(subdir, 'doc.txt'),
      destination: join(subdir, 'copy.txt'),
    });
    expect(await readFile(join(subdir, 'copy.txt'), 'utf-8')).toBe('doc-content');

    // Verify: 3 ops logged
    const lgBefore = (await invoke('ops.log', { path: wsRoot })) as {
      entries: Array<{ id: string; command: string }>;
      total: number;
    };
    expect(lgBefore.total).toBeGreaterThanOrEqual(3);

    // ops.rollback with since:0 undoes all three in DESC order:
    //   copy (newest) → write → mkdir (oldest, rmdired only when subdir is empty)
    const rb = (await invoke('ops.rollback', {
      since: 0,
      dryRun: false,
      path: wsRoot,
    })) as { dryRun: boolean; undone: number; failed: number; failedOperations: unknown[] };

    expect(rb.dryRun).toBe(false);
    expect(rb.failed).toBe(0);
    expect(rb.undone).toBeGreaterThanOrEqual(3);

    // All three artifacts should be gone
    await expect(stat(join(subdir, 'copy.txt'))).rejects.toThrow();
    await expect(stat(join(subdir, 'doc.txt'))).rejects.toThrow();
    await expect(stat(subdir)).rejects.toThrow();
  } finally {
    await app.close();
    await server.close();
    if (existsSync(wsRoot)) rmSync(wsRoot, { recursive: true, force: true });
  }
});
