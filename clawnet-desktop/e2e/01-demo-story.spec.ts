// e2e/01-demo-story.spec.ts
// Headline e2e: Login → conversation list → message history → send → scripted stream.
import { test, expect } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import { STREAM_TIMELINE } from './fixtures/stream-script';

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

test('demo story: login → conversation → stream → final message', async () => {
  const { window } = app;

  // Login screen — Server URL field should be pre-filled by main process via
  // settings.defaultServerURL.get IPC (using CLAWNET_E2E_SERVER_URL).
  await expect(window.getByRole('heading', { name: /ClawNet/i })).toBeVisible();
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();

  // MainShell — wait for the "Connected" pill to appear. The legacy "Hi,
  // {userName}" welcome banner was removed in commit b0856f1 ("strip
  // theme/lang/quit toolbar, free macOS traffic-light area"); the
  // Connected pill is now the single signal that MainShell mounted and
  // the gateway is up.
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  // Conversation list populated
  const conversation = window.getByText('Helper Agent').first();
  await expect(conversation).toBeVisible();
  await conversation.click();

  // Message history loaded
  // "Hi there!" appears in both the message bubble AND the conversation
  // sidebar's last_message_preview — match the first (the bubble in the
  // message list, since the sidebar text is rendered before the list).
  await expect(window.getByText('Hi there!').first()).toBeVisible();

  // Send a message
  const composer = window.getByPlaceholder(/Type a message/i);
  await composer.fill('Hello agent');
  await composer.press('Enter');

  // Drive the scripted stream into the gateway
  await server.pushTimeline(server.getActiveSockets(), STREAM_TIMELINE);

  // Final streamed message visible
  await expect(window.getByText(/Hello there, how can I help you today/)).toBeVisible({
    timeout: 5000,
  });
});
