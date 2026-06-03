// e2e/14-profile-settings.spec.ts
//
// P3B profile + change password + language switch end-to-end.
//
// Covers the three settings-pane flows landed in P3B:
//   1. ProfileSettingsPanel: edit displayName, save, see "Saved" flash.
//   2. ChangePasswordSheet: 3-field sheet, success state + auto-dismiss.
//   3. GeneralSettingsPanel: language picker drives renderer i18n switch.
//
// The fake-server exposes:
//   GET    /api/v1/users/me            -> initial meState (seeded from LOGIN_RESPONSE)
//   PATCH  /api/v1/users/me            -> updates meState (snake_case body)
//   PATCH  /api/v1/auth/password       -> validates old_password vs serverPassword
//   PUT    /api/v1/users/me/language   -> 204, captures serverLanguage
//
// Initial fake-server credentials: any non-empty email/password is accepted
// by /auth/login; the ChangePasswordSheet's "current password" must equal
// the fake-server's seeded `serverPassword` (= 'tempPass1') for success.

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

test('settings → profile: edit displayName, change password, switch language', async () => {
  const { window } = app;

  // --- Sign in (mirror spec 13's pattern) ---
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('tempPass1');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  // --- Open Settings from nav sidebar ---
  await window.getByRole('button', { name: /^Settings$/ }).click();

  // SettingsLayout defaults to the Profile page. Read-only fields appear
  // exactly as meState reports them (userCode = 'C0001', email = canned).
  // Scope to the "Basic Info" section because the email also appears in
  // the sidebar user card (strict-mode would otherwise fail).
  const basicInfo = window.locator('section').filter({ hasText: /Basic Info/i });
  await expect(basicInfo.getByText('C0001')).toBeVisible({ timeout: 5_000 });
  await expect(basicInfo.getByText('e2e@clawnet.test')).toBeVisible();

  // --- Edit displayName, click Save ---
  // ProfileSettingsPanel renders a single <input type="text"> for the
  // name field; scope by section to be safe.
  const nameInput = basicInfo.locator('input[type="text"]');
  await expect(nameInput).toHaveValue('E2E User'); // seeded from /me
  await nameInput.fill('Renamed');
  await window.getByRole('button', { name: /Save Changes/i }).click();
  await expect(window.getByText(/^Saved$/)).toBeVisible({ timeout: 5_000 });

  // --- Open ChangePasswordSheet ---
  await window.getByRole('button', { name: /Change Password/i }).click();
  // The sheet portals into <body>; its heading echoes "Change Password".
  await expect(
    window.getByRole('heading', { name: /Change Password/i }),
  ).toBeVisible();

  // The three password fields use placeholder text from profile.json:
  //   Current password / New password (min 6 characters) / Confirm new password
  await window.locator('input[placeholder="Current password"]').fill('tempPass1');
  await window.locator('input[placeholder^="New password"]').fill('newPass1');
  await window.locator('input[placeholder="Confirm new password"]').fill('newPass1');

  // Submit. The "Confirm" button label is the only ^Confirm$ button in
  // the modal; getByRole works through React portals.
  await window.getByRole('button', { name: /^Confirm$/ }).click();
  await expect(window.getByText(/Password changed/i)).toBeVisible({ timeout: 5_000 });

  // Sheet auto-dismisses after 1.5 s (ChangePasswordSheet line 58).
  await expect(
    window.getByRole('heading', { name: /Change Password/i }),
  ).toBeHidden({ timeout: 5_000 });

  // --- Switch to General page → change language → assert i18n applied ---
  // The SettingsSidebar renders each row as `<icon> <label>` inside one
  // button, so the accessible name is e.g. "⚙ General" — match on the
  // word boundary, anchored at the trailing edge.
  await window.getByRole('button', { name: /General$/ }).click();

  // GeneralSettingsPanel renders a single <select>; pick zh-Hans.
  const langSelect = window.locator('select').first();
  await langSelect.selectOption('zh-Hans');

  // Sidebar header re-renders with the Chinese "设置" string after the
  // i18n change resolves (async, but typically <300 ms). Use the sidebar
  // header specifically — there are several "设置" candidates after
  // switch (panel title, sidebar header).
  await expect(window.getByText('设置').first()).toBeVisible({ timeout: 5_000 });
});
