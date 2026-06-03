// e2e/08-rich-cards.spec.ts
// Rich-card rendering: log in, open the seeded agent conversation, confirm
// every rich-card variant in the MESSAGES_RESPONSE fixture renders a
// dedicated card (not the [unsupported] placeholder).
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

test('all rich-card variants render (no [unsupported] placeholders)', async () => {
  const { window } = app;

  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });
  await window.getByText('Helper Agent').first().click();

  // Each fixture row has a distinctive characteristic — match by testid first
  // (defined on each card component) and by text for human-readable assertion.
  await expect(window.getByTestId('task-progress-card')).toBeVisible({ timeout: 5_000 });
  await expect(window.getByText(/Analyzing payload/i)).toBeVisible();

  await expect(window.getByTestId('task-result-card')).toBeVisible();
  await expect(window.getByText(/Processed 5 files/i)).toBeVisible();

  await expect(window.getByTestId('approval-card')).toBeVisible();
  await expect(window.getByText(/Write config\.json/i)).toBeVisible();

  await expect(window.getByTestId('dialog-request-card')).toBeVisible();
  await expect(window.getByText(/sync calendars/i)).toBeVisible();

  await expect(window.getByTestId('generic-rich-card')).toBeVisible();
  await expect(window.getByText(/execution\.log/i)).toBeVisible();

  // dialog_status uses a plain-text fallback (no card chrome).
  await expect(window.getByText(/Dialog terminated after 3 rounds/i)).toBeVisible();

  // No [unsupported] placeholder anywhere in the message list.
  await expect(window.getByText(/\[unsupported content\]/)).not.toBeVisible();
});
