// e2e/02-disconnect-recovery.spec.ts
// Validates the ConnectionManager's reconnect path. After login the gateway
// is Connected. We terminate the WS from the server side; the renderer's
// StatusPill should show Reconnecting…, then return to Connected once the
// gateway re-opens.
//
// Scope the connection-state assertions to the sidebar StatusPill, which
// has a stable accessible name ("Connection <label>, click to retry").
// Without scoping, StatusBar (mounted at the top of ChatContainer in P3D)
// also renders the same "Reconnecting…" / "Connected" copy, which trips
// Playwright's strict-mode locator resolution.
import { test, expect } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';

let server: FakeServer;
let app: LaunchResult;

test.beforeEach(async () => {
  server = await startFakeServer();
  app = await launchApp({ serverURL: server.url });
});

test.afterEach(async () => {
  await app.close();
  await server.close();
});

test('disconnect → reconnect cycle', async () => {
  const { window } = app;

  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  // StatusPill is the source-of-truth element for the connection-state
  // assertion; its aria-label embeds the state so /Connection Connected/i
  // disambiguates from the chat-area StatusBar (P3D).
  await expect(window.getByLabel(/Connection Connected/i)).toBeVisible({ timeout: 10_000 });

  // Forcibly close the active socket from the fake server. ConnectionManager
  // will see the disconnect and transition to reconnecting before retrying.
  for (const s of server.getActiveSockets()) s.terminate();
  await expect(window.getByLabel(/Connection Reconnecting/i)).toBeVisible({ timeout: 8000 });

  // ConnectionManager exponential backoff will retry; the next reconnect
  // will succeed because the WS server is still listening.
  await expect(window.getByLabel(/Connection Connected/i)).toBeVisible({ timeout: 30_000 });
});
