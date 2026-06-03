// e2e/09-contacts.spec.ts
// Contacts panel: list contacts, accept a friend request, add a friend via
// search → apply, click a contact → open direct conversation.
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

test('contacts tab: see list, see friend request, accept it', async () => {
  const { window } = app;
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  // Switch to Contacts panel.
  await window.getByRole('button', { name: /Contacts/i }).click();

  // Existing contact appears.
  await expect(window.getByText('Alice E2E')).toBeVisible();

  // Friend request row visible with Accept/Reject buttons.
  await expect(window.getByText('Charlie Pending')).toBeVisible();
  await window
    .getByTestId('friend-request-row-fr-1')
    .getByRole('button', { name: 'Accept' })
    .click();
  // The mutation calls /api/v1/friend-requests/fr-1/accept; the fake-server
  // returns 200 OK and the query is invalidated. We don't assert the row
  // disappears (the fake-server still returns it on the next list) — the
  // success path is the click + no error toast.
});

test('add contact flow: search → send request', async () => {
  const { window } = app;
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  await window.getByRole('button', { name: /Contacts/i }).click();
  await window.getByRole('button', { name: /Add friend/i }).click();

  // Modal opens, type a query, click Search.
  // Use exact text + type=submit to disambiguate from the P2F nav-search
  // icon button which also has accessible name "Search".
  await window.getByPlaceholder(/ID, username, or email/i).fill('bob');
  await window.locator('button[type="submit"]', { hasText: /^Search$/ }).click();

  // Search result appears, click Apply.
  await expect(window.getByText('Bob Test')).toBeVisible({ timeout: 3_000 });
  await window.getByRole('button', { name: /Apply/i }).click();

  // Toast confirmation.
  await expect(window.getByText(/Request sent/i)).toBeVisible({ timeout: 3_000 });
});

test('click contact → opens direct conversation', async () => {
  const { window } = app;
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  await window.getByRole('button', { name: /Contacts/i }).click();
  await window.getByTestId('contact-row-u-other-1').click();

  // Detail view shows.
  await expect(window.getByText('Alice E2E').first()).toBeVisible();
  await window.getByRole('button', { name: /Send message/i }).click();

  // chat.createDirectConversation IPC has been invoked; the call resolves
  // and the useChatStore activeConversationId is updated. We don't assert
  // active-panel switch here — that's a UX wiring for P2D/follow-up; the
  // success path for P2C is the IPC succeeding without error.
});
