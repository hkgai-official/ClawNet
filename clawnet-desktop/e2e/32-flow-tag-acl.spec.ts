// e2e/32-flow-tag-acl.spec.ts
//
// Stage 2: tag with ACL (round-5 N #P1 end-to-end).
//
// Creates a tag, opens the EDIT sheet (CreateTag sheet doesn't surface
// deniedPaths editor when allowedPaths is empty — needs to round-trip
// first), adds a denied path, saves. Asserts the PATCH body contains
// the denied_paths array.

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

test('Stage 32: create tag, add a denied path, save → PATCH carries denied_paths', async () => {
  const { window } = app;
  await login(window);

  // Settings → Tags
  await window.getByRole('button', { name: /^Settings$/i }).click();
  await window.getByRole('button', { name: /Tags$/ }).click();

  // Create a tag named Workspace (the CreateTagSheet has the DeniedPaths
  // editor too, so we can set the path during creation).
  await window.getByRole('button', { name: /^New Tag$/ }).click();
  // Round-6 Sheet migration: dialog now has role="dialog" anchoring.
  await expect(window.getByRole('heading', { name: /^New Tag$/ })).toBeVisible();
  const sheet = window.getByRole('dialog');
  await sheet.getByRole('textbox').first().fill('Workspace');

  // Add a denied path via the DeniedPathsEditor (round-5 N #P1).
  // The placeholder is "e.g. /Users/me/secrets or **/.env"
  const deniedInput = sheet.getByPlaceholder(/Users\/me\/secrets|\.env/i);
  await deniedInput.fill('**/.env');
  await sheet.getByRole('button', { name: /^Add$/i }).click();
  // The chip list shows the path.
  await expect(sheet.getByText('**/.env')).toBeVisible();

  await sheet.getByRole('button', { name: /^Create$/i }).click();

  // The tag appears in the list.
  await expect(window.getByText('Workspace')).toBeVisible({ timeout: 5_000 });

  // Now edit it → toggle a path → save → assert PATCH body has denied_paths.
  // The button label is "Edit Tag" (i18n key tags:editTag).
  await window.getByRole('button', { name: /^Edit Tag$/ }).first().click();
  await expect(window.getByRole('heading', { name: /^Edit Tag$/ })).toBeVisible();
  const editSheet = window.getByRole('dialog');
  // Add a second denied path.
  const editDeniedInput = editSheet.getByPlaceholder(/Users\/me\/secrets|\.env/i);
  await editDeniedInput.fill('/Users/alice/.ssh');
  await editSheet.getByRole('button', { name: /^Add$/i }).click();
  await editSheet.getByRole('button', { name: /^Save$/i }).click();

  // Wait for the PATCH to land.
  let lastPatch: { id: string; body: unknown } | null = null;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    lastPatch = await handles.getLastTagPatch();
    if (lastPatch) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(lastPatch, 'PATCH /api/v1/tags/:id was never observed').toBeTruthy();
  const body = lastPatch!.body as {
    node_acl?: { denied_paths?: string[]; allowed_paths?: string[] };
  };
  expect(body.node_acl?.denied_paths ?? []).toEqual(
    expect.arrayContaining(['**/.env', '/Users/alice/.ssh']),
  );
});
