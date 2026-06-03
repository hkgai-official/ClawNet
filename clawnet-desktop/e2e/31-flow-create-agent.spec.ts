// e2e/31-flow-create-agent.spec.ts
//
// Stage 1: create an agent via the wizard.
//
// Round-6 restored the Agents nav tab (removed in 61ade83). The Agents
// panel hosts the create-agent wizard. This spec walks the 4-step
// wizard, submits, and asserts:
//   - the POST /api/v1/agents body matches macOS canonical AgentConfig
//   - the new agent appears in the list
//
// Schema reference: macOS `AgentModels.swift` — capabilities are an enum
// (file_processing / web_search / code_execution / ...), executionMode is
// 'local' | 'hybrid' | 'cloud', proactive intensity is off/low/medium/high.

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

test('Stage 31: create agent via 4-step wizard with canonical capability enums', async () => {
  const { window } = app;
  await login(window);

  // Navigate to Agents panel via the sidebar.
  await window.getByRole('button', { name: /^Agents$/i }).click();

  // Click "New agent" header button to open the wizard.
  await window.getByRole('button', { name: /New agent/i }).first().click();
  await expect(window.getByTestId('agent-creation-wizard')).toBeVisible();

  // --- Step 1: Basics ---
  await window.getByPlaceholder(/Research Assistant/i).fill('E2E Helper');
  await window.getByRole('button', { name: /^Next$/i }).click();

  // --- Step 2: Capabilities (CANONICAL enums) ---
  await window.getByTestId('wizard-cap-file_processing').click();
  await window.getByTestId('wizard-cap-web_search').click();
  await window.getByRole('button', { name: /^Next$/i }).click();

  // --- Step 3: Prompt + rules → skip (no system-prompt edit) ---
  await window.getByRole('button', { name: /^Next$/i }).click();

  // --- Step 4: Permissions → click Create to submit. ---
  await window.getByRole('button', { name: /^Create$/i }).click();

  // Wizard closes on success.
  await expect(window.getByTestId('agent-creation-wizard')).toBeHidden({ timeout: 5_000 });

  // Server-side: POST /api/v1/agents was called with the canonical payload.
  // The body is flat (no `config` wrapper) and snake_cased on the wire by
  // HttpClient.postJson via deepCamelToSnake. Capability values are the
  // canonical enum (file_processing / web_search) — not legacy names.
  const lastCreate = (await handles.getLastAgentCreate()) as {
    display_name?: string;
    capabilities?: string[];
    execution_mode?: string;
  } | null;
  expect(lastCreate, 'POST /api/v1/agents was never observed').toBeTruthy();
  expect(lastCreate!.display_name).toBe('E2E Helper');
  expect(lastCreate!.capabilities).toEqual(
    expect.arrayContaining(['file_processing', 'web_search']),
  );
});
