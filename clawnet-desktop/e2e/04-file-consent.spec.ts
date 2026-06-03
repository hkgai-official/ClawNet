// e2e/04-file-consent.spec.ts
// After login + gateway-connected, push an `agent.command.fileAccess` frame
// into the gateway. FileCommandHandler runs CommandPolicy.check → returns
// pending-consent (no bookmark for the requested path) → broadcasts
// `fileAccess.consentRequired`. The renderer's ConsentBanner picks it up
// from the consent slice and renders the path + "Allow always" action.
import { test, expect } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import { CONSENT_TIMELINE } from './fixtures/stream-script';

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

test('agent.command.fileAccess → ConsentBanner → allow always', async () => {
  const { window } = app;

  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  await server.pushTimeline(server.getActiveSockets(), CONSENT_TIMELINE);

  // ConsentBanner shows the requested path + the requesting agent name.
  const pathLocator = window.getByText(/NewFolder\\data\.txt/);
  await expect(pathLocator).toBeVisible({ timeout: 5000 });
  await expect(window.getByText(/Helper Agent/i).first()).toBeVisible();

  await window.getByRole('button', { name: /Allow always/i }).click();

  // ConsentBanner unmounts once the consent is granted (the only pending
  // request was the one we pushed).
  await expect(pathLocator).toHaveCount(0, { timeout: 5000 });
});
