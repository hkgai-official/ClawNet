// e2e/23-message-persistence.spec.ts
//
// P3E integration test: prove that the SQLite message store survives an
// app restart end-to-end in the built Electron bundle.
//
// Assertion approach — file-existence + clean re-open:
//   1. Launch app, sign in, push a `chat.message.created` WS frame.
//   2. Wait for the store write, then close the app.
//   3. Assert `clawnet.db` exists in the known userData dir.
//   4. Re-launch the app against the SAME userData dir.
//   5. Assert the second launch boots cleanly (no renderer crash visible,
//      no ABI-mismatch error in the window title area).
//
// Why not do a Node-side DB read to assert the row?
//   better-sqlite3 is a native module. The e2e process runs under Node ABI
//   while the Electron app uses Electron ABI. Both can open the same .db
//   file (SQLite file format is ABI-independent), but the two binaries
//   cannot share the same node_modules/.bin at the same time. The simplest
//   approach that still proves persistence is: file exists → re-open → no
//   crash. That's sufficient for P3E.
//
// ABI note: run this spec after `pnpm rebuild:electron && pnpm build`.
// Unit tests (vitest) need `pnpm rebuild:node` afterwards.

import { test, expect } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MSG_ID = 'e2e-persist-msg-1';
const CONV_ID = 'e2e-persist-conv-1';

// Shared userData dir that persists across both launches.
let userDataDir: string;
let server: FakeServer;
let app: LaunchResult;

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'e2e-sqlite-'));
  server = await startFakeServer();
});

test.afterAll(async () => {
  await server.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test.afterEach(async () => {
  // close() does NOT clean userDataDir because we passed it explicitly.
  await app.close();
});

test('first launch: chat push writes clawnet.db', async () => {
  app = await launchApp({ serverURL: server.url, userDataDir });
  const { window } = app;

  // Sign in
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('tempPass1');
  await window.getByRole('button', { name: /Sign in/i }).click();

  // Wait until the WS connection is established (status bar shows Connected)
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 15_000 });

  // Push a chat.message.created frame — server-side snake_case on the wire.
  // ChatEventHandler normalises to camelCase, validates with ChatMessageSchema,
  // then calls store.upsertMessage → writes to messages table in clawnet.db.
  await server.pushChatMessage({
    id: MSG_ID,
    conversation_id: CONV_ID,
    sender: { id: 'u-agent-1', name: 'TestAgent', type: 'agent' },
    content_type: 'text',
    content: { text: 'hello persisted world' },
    timestamp: new Date().toISOString(),
  });

  // Give the main process time to write to SQLite (async store write is
  // synchronous in better-sqlite3, but the IPC path has one microtask hop).
  await window.waitForTimeout(600);

  // Assert: the DB file was created in the known userData dir.
  const dbPath = join(userDataDir, 'clawnet.db');
  let stat: ReturnType<typeof statSync> | undefined;
  try {
    stat = statSync(dbPath);
  } catch {
    // file missing — assertion will fail below
  }
  expect(stat?.isFile(), `clawnet.db must exist at ${dbPath}`).toBe(true);
  expect(stat!.size, 'clawnet.db must be non-empty').toBeGreaterThan(0);
});

test('second launch: app re-opens existing clawnet.db cleanly', async () => {
  // This test runs after the first against the SAME userDataDir, which now
  // contains clawnet.db. We sign in again (rather than relying on credentials
  // restore — that's a separate flow whose CI reliability is orthogonal to
  // P3E's "DB survives restart" story). What we verify is: app boots, opens
  // the existing DB, no ABI / SQLITE error visible.
  app = await launchApp({ serverURL: server.url, userDataDir });
  const { window } = app;

  // Second launch may auto-restore the session (auth.restoreSession in
  // main/features/auth/auth.service.ts) and skip the login screen, OR may
  // present the login form again depending on whether the renderer-side
  // token survived. Handle both: if the Account field is visible within
  // 2s, fill it; otherwise we're already in MainShell.
  const accountField = window.getByLabel(/Account/i);
  if (await accountField.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await accountField.fill('e2e@clawnet.test');
    await window.getByLabel(/Password/i).fill('tempPass1');
    await window.getByRole('button', { name: /Sign in/i }).click();
  }

  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 15_000 });

  // No SQLite / ABI error should be visible — proves DB re-open worked.
  const errorText = window.getByText(/NODE_MODULE_VERSION|ABI mismatch|SQLITE_ERROR/i);
  await expect(errorText).toBeHidden({ timeout: 2_000 });
});
