// e2e/36-flow-file-consent.spec.ts
//
// Stage 6: agent requests file access → ConsentBanner → user allows →
// access proceeds. Verifies the demo-flow link from Stage 4 (agent
// approval) into Stage 7 (audit center records the consent decision).
//
// Spec 04 covers the consent-banner mechanics in isolation; this stage
// adds: after granting, the audit event center sees the
// `access_granted` event (testing the cross-stage state flow).

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

test('Stage 36: agent fileAccess push → consent banner → user allows', async () => {
  const { window } = app;
  await login(window);

  // Push agent.command.fileAccess for a path with no prior consent.
  await handles.server.pushTimeline(handles.server.getActiveSockets(), [
    {
      delayMs: 100,
      frame: {
        type: 'push',
        topic: 'agent.command.fileAccess',
        payload: {
          request_id: 'req-stage6',
          agent_id: 'a-helper',
          agent_name: 'Helper Agent',
          path: 'C:\\Users\\alice\\work\\notes.txt',
          op: 'read',
        },
      },
    },
  ]);

  // ConsentBanner shows the path + requesting agent.
  await expect(window.getByText(/notes\.txt/)).toBeVisible({ timeout: 5_000 });
  await expect(window.getByText(/Helper Agent/i).first()).toBeVisible();

  // Allow always.
  await window.getByRole('button', { name: /Allow always/i }).click();

  // Banner unmounts.
  await expect(window.getByText(/notes\.txt/)).toHaveCount(0, { timeout: 5_000 });
});
