// e2e/13-tag-management.spec.ts
//
// P3A tag CRUD: open Settings → Tags tab → empty state → create tag →
// see it in list → delete it (window.confirm accepted) → list empty again.
//
// The TagManagementPanel uses window.confirm() to gate deletion, which
// Playwright surfaces as a "dialog" page event; we register an acceptor
// in beforeEach so the deletion path goes through without manual handling.
import { test, expect } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';

let server: FakeServer;
let app: LaunchResult;

test.beforeEach(async () => {
  server = await startFakeServer();
  app = await launchApp({ serverURL: server.url });
  // Auto-accept native confirm() dialogs (used by the tag delete action).
  app.window.on('dialog', (dialog) => {
    void dialog.accept();
  });
});

test.afterEach(async () => {
  await app.close();
  await server.close();
});

test('settings → tags: empty state, create a tag, delete it', async () => {
  const { window } = app;
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  // Open Settings panel from the nav sidebar.
  await window.getByRole('button', { name: /^Settings$/ }).click();

  // Switch to the Tags page in the new sidebar (P3B Task 11 replaced the
  // horizontal tab-nav with a vertical sidebar+detail layout). Each
  // SettingsSidebar row renders as `<icon> <label>`, so the accessible
  // name for the Tags row is "🏷 Tags". Anchor with `Tags$` to avoid the
  // outer nav-sidebar `Settings` button and the `🏷` icon prefix.
  await window.getByRole('button', { name: /Tags$/ }).click();

  // Empty state: no tags yet, the "No paths configured" hint stands in for
  // the empty list (the panel reuses that copy when tags.length === 0).
  await expect(window.getByText(/No paths configured/i)).toBeVisible();

  // Open the create sheet.
  await window.getByRole('button', { name: /^New Tag$/ }).click();

  // The sheet's heading is "New Tag" too; the only autofocused textbox in
  // the modal is the displayName input. The <label>Tag name</label> is not
  // associated to the input via htmlFor, so getByLabel won't work here —
  // grab the first textbox under the dialog instead.
  const heading = window.getByRole('heading', { name: /^New Tag$/ });
  await expect(heading).toBeVisible();
  // Find the Sheet (role=dialog) ancestor. Round-6 migrated CreateTagSheet
  // to the shared <Sheet> primitive which sets role="dialog" + aria-modal.
  // The header is no longer a sibling of the input; both live inside the
  // same dialog root.
  const sheet = window.getByRole('dialog');
  // Round-5 added a second textbox (denied-paths input). The tag-name
  // input is the FIRST textbox; the denied-paths input has the
  // placeholder "e.g. /Users/me/secrets or **/.env".
  await sheet.getByRole('textbox').first().fill('Workspace');

  // Anchor the Create button name to avoid matching "New Tag".
  await sheet.getByRole('button', { name: /^Create$/ }).click();

  // The created tag row appears in the list.
  await expect(window.getByText('Workspace')).toBeVisible({ timeout: 5_000 });

  // Delete is a TWO-step inline confirm (tag-management-panel.tsx:119-149):
  //   1st click: row's ghost "Delete" → reveals "<confirm copy> Delete Cancel"
  //   2nd click: the new primary "Delete" → mutation actually fires.
  await window.getByRole('button', { name: /^Delete$/ }).first().click();
  // Wait for the inline confirm copy to render so we can target the
  // primary "Delete" button (now the LAST /^Delete$/ in the row).
  await expect(window.getByText(/Delete tag/i).first()).toBeVisible({ timeout: 2_000 });
  await window.getByRole('button', { name: /^Delete$/ }).last().click();

  // After deletion, the tag is gone and the empty hint reappears.
  await expect(window.getByText('Workspace')).toHaveCount(0, { timeout: 5_000 });
  await expect(window.getByText(/No paths configured/i)).toBeVisible();
});
