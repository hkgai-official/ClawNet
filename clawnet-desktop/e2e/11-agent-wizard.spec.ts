// e2e/11-agent-wizard.spec.ts
// Agent wizard flow: create a real agent on the fake server using the
// canonical capability enum, and assert that legacy enum values cannot be
// selected from the wizard UI (regression-proof for the 4th schema drift).
//
// NOTE (2026-05-13): the "Agents" sidebar entry was removed in commit
// 61ade83 ("fix(ux): remove Agents tab, fix sign-out icon, ..."), and the
// AgentsPanel component is currently orphaned — there is no UI entry
// point to reach the wizard. These tests are skipped until the Agents
// surface gets re-wired (a follow-up PR will add an Agents tab back, at
// which point the .skip can be removed).
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

async function openAgentsPanel(window: LaunchResult['window']) {
  // Sidebar nav: "Agents" tab. matches en-US label per i18n.
  await window.getByRole('button', { name: /Agents/i }).first().click();
}

test.skip('4-step wizard: create agent with canonical capabilities → appears in list', async () => {
  const { window } = app;
  await login(window);
  await openAgentsPanel(window);

  // Open the wizard via the header "+ New agent" button.
  await window.getByRole('button', { name: /New agent/i }).first().click();
  await expect(window.getByTestId('agent-creation-wizard')).toBeVisible();

  // Step 1: basics
  await window.getByPlaceholder(/Research Assistant/i).fill('E2E Bot');
  await window.getByRole('button', { name: /^Next$/i }).click();

  // Step 2: capabilities — pick two CANONICAL values
  await window.getByTestId('wizard-cap-file_processing').click();
  await window.getByTestId('wizard-cap-web_search').click();
  await window.getByRole('button', { name: /^Next$/i }).click();

  // Step 3: prompt + rules — skip
  await window.getByRole('button', { name: /^Next$/i }).click();

  // Step 4: permissions — accept defaults
  await window.getByRole('button', { name: /^Create$/i }).click();

  await expect(window.getByTestId('agent-creation-wizard')).not.toBeVisible({ timeout: 3000 });

  // Agent appears in the list after invalidation refresh
  await expect(window.getByText('E2E Bot')).toBeVisible({ timeout: 3000 });
});

test.skip('legacy capability values are impossible to send (wizard only renders canonical buttons)', async () => {
  const { window } = app;
  await login(window);
  await openAgentsPanel(window);

  await window.getByRole('button', { name: /New agent/i }).first().click();
  await window.getByPlaceholder(/Research Assistant/i).fill('Legacy probe');
  await window.getByRole('button', { name: /^Next$/i }).click();

  // The 7 fabricated pre-P2E values must NOT have rendered test ids.
  for (const legacy of ['chat', 'file_read', 'file_write', 'web_browse', 'code_exec', 'screen', 'voice']) {
    await expect(window.getByTestId(`wizard-cap-${legacy}`)).toHaveCount(0);
  }
  // Smoke: at least one canonical value is rendered.
  await expect(window.getByTestId('wizard-cap-file_processing')).toBeVisible();
});
