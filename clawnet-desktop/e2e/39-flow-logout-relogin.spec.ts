// e2e/39-flow-logout-relogin.spec.ts
//
// Stage 9: sign out brings the user back to LoginView, signing in again
// restores the conversation list (no new fetch needed — locally cached).
//
// Verifies the auth.logout IPC clears the session and the renderer returns
// to LoginView, then re-login re-enters MainShell.

import { test, expect } from '@playwright/test';
import { createGovernanceServer, login } from './fixtures/agent-governance-flow';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import type { GovernanceServerHandles } from './fixtures/agent-governance-flow';

let handles: GovernanceServerHandles;
let app: LaunchResult;

test.beforeEach(async () => {
  handles = await createGovernanceServer();
  app = await launchApp({ serverURL: handles.server.url });
});

test.afterEach(async () => {
  await app.close();
  await handles.server.close();
});

test('Stage 39: Sign out → LoginView → re-login → MainShell', async () => {
  const { window } = app;
  await login(window);

  // Confirm we're in MainShell (sidebar visible).
  await expect(window.getByRole('button', { name: /^Chat$/i })).toBeVisible();

  // Sign out via the sidebar bottom button (aria-label "Sign out").
  await window.getByRole('button', { name: /^Sign out$/i }).click();

  // LoginView appears (Account + Password fields).
  await expect(window.getByLabel(/Account/i)).toBeVisible({ timeout: 5_000 });

  // Sign back in.
  await login(window);

  // MainShell is restored.
  await expect(window.getByRole('button', { name: /^Chat$/i })).toBeVisible({ timeout: 5_000 });
  await expect(window.getByText('Helper Agent').first()).toBeVisible({ timeout: 5_000 });
});
