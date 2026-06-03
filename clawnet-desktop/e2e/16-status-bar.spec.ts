// e2e/16-status-bar.spec.ts
//
// P3D StatusBar: verify the zero-noise rule — StatusBar is mounted at the top
// of ChatContainer but renders `null` when (status === 'connected' && !isStreaming).
// After signing in against the fake server, we land on the default chat panel
// with a healthy WS connection and no in-flight stream. The banner copy
// ("Gateway unreachable", "Generating…") must not appear.
//
// This is the steady-state assertion only (Option A). Driving an artificial
// `connection.statusChanged` from the fake server would require a new
// WS-side test hook in main-process (connection.onStatusChanged feeds from
// the WS client, not from a relay event we can synthesize from the server
// side), so we ship the visible/hidden check.

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

test.describe('P3D StatusBar', () => {
  test('hidden in connected steady-state', async () => {
    const { window } = app;

    // --- Sign in (mirror spec 14/15's pattern) ---
    await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
    await window.getByLabel(/Password/i).fill('tempPass1');
    await window.getByRole('button', { name: /Sign in/i }).click();
    // The StatusPill in the sidebar reports "Connected" once the WS reaches
    // the connected state. The StatusBar component itself returns null at
    // this point — this assertion only confirms we're past the connecting
    // phase before checking that StatusBar is hidden.
    await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

    // Default activePanel is 'chat' so ChatContainer is mounted (App.tsx:85)
    // and StatusBar is its first child (chat-container.tsx:55). With
    // status === 'connected' && !isStreaming, StatusBar's early return at
    // status-bar.tsx:26 means none of the banner copy is in the DOM.

    // The "Gateway unreachable" string lives only inside the StatusBar
    // disconnected/error branch (status-bar.tsx:46). If StatusBar rendered,
    // this would be visible whenever lastError was set.
    await expect(window.getByText(/Gateway unreachable/i)).toHaveCount(0);

    // "Generating…" lives only inside the StatusBar streaming branch
    // (status-bar.tsx:108). Absent ⇒ no stream is in flight.
    await expect(window.getByText(/Generating/i)).toHaveCount(0);

    // Belt-and-braces: the dot indicator + spinner are aria-hidden so we
    // anchor on the only translated label that StatusBar would render when
    // visible: "Disconnected" / "Reconnecting…" / "Connecting…". None of
    // those should be visible either. (We avoid matching /Connected/ since
    // that's exactly what StatusPill in the sidebar reads.)
    await expect(window.getByText(/^Disconnected/)).toHaveCount(0);
    await expect(window.getByText(/Reconnecting/)).toHaveCount(0);
    await expect(window.getByText(/Connecting/)).toHaveCount(0);
  });
});
