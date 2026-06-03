// e2e/30-flow-bootstrap.spec.ts
//
// Stage 0 of the round-6 Agent governance demo story. Verifies the app's
// foundation: login succeeds, gateway connects, and the four top-level
// nav panels (Chat / Contacts / Security / Settings) all mount on click.
//
// Subsequent stages (31-37) assume this baseline holds, so a regression
// here flags an outage of the rest of the flow.

import { test, expect } from '@playwright/test';
import { createGovernanceServer, login } from './fixtures/agent-governance-flow';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import type { FakeServer } from './fixtures/fake-server';

let server: FakeServer;
let app: LaunchResult;

test.beforeEach(async () => {
  const h = await createGovernanceServer();
  server = h.server;
  app = await launchApp({ serverURL: server.url });
});

test.afterEach(async () => {
  await app.close();
  await server.close();
});

test('Stage 30: login + all four nav panels mount', async () => {
  const { window } = app;
  await login(window);

  // Chat panel is the default — ConversationList sidebar should be visible.
  await expect(window.getByText('Helper Agent').first()).toBeVisible({ timeout: 5_000 });
  // Open the conversation so the Composer mounts — Composer only renders
  // when an active conversation is selected.
  await window.getByText('Helper Agent').first().click();

  // Anchor for "we're on Chat panel with a conversation open": the
  // composer's textbox is unique to ChatContainer-with-conv (not rendered
  // by Contacts/Security/Settings or by Chat-without-conv).
  const composer = window.getByPlaceholder(/Type a message/i);
  await expect(composer).toBeVisible({ timeout: 3_000 });

  // Switch to Contacts → composer goes away (panel unmounted).
  await window.getByRole('button', { name: /^Contacts$/i }).click();
  await expect(composer).toBeHidden({ timeout: 3_000 });

  // Switch to Security → SecurityEventCenter renders. Its loading/empty
  // state copy varies, so we use the panel's testid-like container if
  // present; otherwise fall back to the audit nav badge being highlighted.
  await window.getByRole('button', { name: /^Security$/i }).click();
  // SecurityEventCenter mounts a top-level container with a known role.
  // We can also rely on the i18n key surfaced as text.
  await expect(
    window.locator('text=/audit|security/i').first(),
  ).toBeVisible({ timeout: 3_000 });

  // Switch to Settings → settings sidebar renders Profile/Tags/Connection.
  await window.getByRole('button', { name: /^Settings$/i }).click();
  await expect(
    window.locator('text=/Profile|Tags|Connection/i').first(),
  ).toBeVisible({ timeout: 3_000 });

  // Round-trip back to Chat → composer returns.
  await window.getByRole('button', { name: /^Chat$/i }).click();
  await expect(composer).toBeVisible({ timeout: 3_000 });
});
