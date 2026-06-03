// e2e/10-group-conversations.spec.ts
// Group conversation flow: create a new group from contacts, open the
// detail panel, invite + remove a member, rename the group inline.
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

async function login(window: LaunchResult['window']) {
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });
}

test('create group → see in sidebar → open detail → rename', async () => {
  const { window } = app;
  await login(window);

  // 1. Open the New-Conversation modal from the sidebar "+" (aria-label
  //    "New Conversation"), then click "Create Group" inside it to launch
  //    the actual new-group modal. (P3B sidebar refactor replaced the
  //    direct "New group" entry point with this two-step path.)
  await window.getByRole('button', { name: /New Conversation/i }).click();
  await window.getByRole('button', { name: /Create Group/i }).click();
  await expect(window.getByTestId('new-group-modal')).toBeVisible();

  // 2. Fill title + select 2 contacts → Create.
  await window.getByPlaceholder(/Group title/i).fill('Sprint Standup');
  await window.getByTestId('new-group-contact-u-other-1').click();
  await window.getByTestId('new-group-contact-u-other-2').click();
  await window.getByRole('button', { name: /^Create$/i }).click();
  await expect(window.getByTestId('new-group-modal')).not.toBeVisible({ timeout: 3_000 });

  // 3. Open the group detail panel via the header info button.
  await window.getByRole('button', { name: /Group detail/i }).click();

  // 4. Three members visible (owner + 2 invitees) with role badges.
  await expect(window.getByTestId('role-badge-owner')).toBeVisible();
  await expect(window.getByTestId('group-member-u-other-1')).toBeVisible();
  await expect(window.getByTestId('group-member-u-other-2')).toBeVisible();

  // 5. Rename via the inline ✎ button (owner only).
  await window.getByRole('button', { name: /Rename group/i }).click();
  // The rename input is the last input on the page (group detail header).
  await window.locator('input').last().fill('Renamed Standup');
  await window.keyboard.press('Enter');
  // The renamed title appears in 3 places (sidebar row, chat header, detail
  // panel header). Any one is enough proof the rename round-tripped.
  await expect(window.getByText('Renamed Standup').first()).toBeVisible({ timeout: 3_000 });
});

test('preexisting seed group: open detail → remove a member', async () => {
  const { window } = app;
  await login(window);

  // Click the seeded "Project Sync" group.
  await window.getByText('Project Sync').click();
  await window.getByRole('button', { name: /Group detail/i }).click();
  await expect(window.getByTestId('group-member-u-other-1')).toBeVisible();

  // Auto-accept the confirm() dialog before clicking remove.
  window.on('dialog', (d) => { void d.accept(); });
  await window
    .getByTestId('group-member-u-other-1')
    .getByRole('button', { name: /Remove/i })
    .click();
  await expect(window.getByTestId('group-member-u-other-1')).not.toBeVisible({ timeout: 3_000 });
});
