// e2e/17-update-settings.spec.ts
//
// P3F Updates section idle-state e2e.
//
// GeneralSettingsPanel (renderer/features/profile/ui/general-settings-panel.tsx)
// appends an "Updates" sub-section that renders a "Check for updates" Button.
// This spec signs in, navigates Settings → General, and asserts the section
// title + button are visible. We do NOT click the button — that would issue a
// real `app.checkForUpdates` IPC and (in non-test environments) probe GitHub.
//
// The fake-server doesn't expose any update endpoints; the test app is launched
// with `CLAWNET_DISABLE_AUTO_UPDATE=1` (set globally by launch-app.ts) so the
// main process skips the 5s auto-check kick-off in main/index.ts.

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

test.describe('P3F Updates section in Settings → General', () => {
  test('shows Check-for-updates button on the General page', async () => {
    const { window } = app;

    // --- Sign in (mirror spec 14/16's pattern) ---
    await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
    await window.getByLabel(/Password/i).fill('tempPass1');
    await window.getByRole('button', { name: /Sign in/i }).click();
    await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

    // --- Open Settings from nav sidebar ---
    // The NavSidebar "Settings" button has aria-label "Settings"; ^Settings$
    // disambiguates it from any settings-pane heading text.
    await window.getByRole('button', { name: /^Settings$/ }).click();

    // SettingsLayout defaults to the Profile page; switch to General. The
    // SettingsSidebar renders each row as `<icon> <label>`, so the accessible
    // name is e.g. "⚙ General" — match on the trailing-edge word.
    await window.getByRole('button', { name: /General$/ }).click();

    // --- Updates section visible ---
    // i18n key `update:title` → "Updates" / "应用更新"
    await expect(window.getByText(/^(Updates|应用更新)$/)).toBeVisible({ timeout: 5_000 });

    // i18n key `update:checkForUpdates` → "Check for updates" / "检查更新"
    // Idle state (no auto-check fires because CLAWNET_DISABLE_AUTO_UPDATE=1)
    // → UpdateButton renders the secondary "Check for updates" affordance.
    // We assert visibility only — clicking would issue `app.checkForUpdates`
    // and (in main) hit the real autoUpdater / GitHub.
    await expect(
      window.getByRole('button', { name: /Check for updates|检查更新/ }),
    ).toBeVisible();
  });
});
