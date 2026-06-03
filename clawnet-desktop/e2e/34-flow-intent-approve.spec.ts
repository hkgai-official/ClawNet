// e2e/34-flow-intent-approve.spec.ts
//
// Stage 4: Intent authorization approve flow as part of the full demo
// chain (after discovery confirm in Stage 3 would trigger this). The
// round-5 spec 25 already covers the pure click→envelope assertion;
// this stage adds the demo-context (server flow continues with a
// subsequent dialog.intent_authorize.success push to confirm idempotency).

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

test('Stage 34: Approve intent → envelope + optimistic flip + server push idempotent', async () => {
  const { window } = app;
  await login(window);
  await window.getByText('Helper Agent').first().click();
  await expect(window.getByPlaceholder(/Type a message/i)).toBeVisible({ timeout: 5_000 });

  // Push an intent_authorization rich-card.
  await handles.server.pushTimeline(handles.server.getActiveSockets(), [
    {
      delayMs: 100,
      frame: {
        type: 'push',
        topic: 'message.new',
        payload: {
          id: 'm-intent-stage4',
          conversation_id: 'c-agent',
          sender: { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
          content_type: 'rich_card',
          content: {
            card_type: 'intent_authorization',
            authorization_id: 'auth-stage4',
            agent_name: 'Helper',
            status: 'pending',
            targets: [{ target_user_name: 'Bob', topic: 'find python expert' }],
          },
          timestamp: '2026-05-14T00:00:10Z',
          status: 'sent',
        },
      },
    },
  ]);

  const card = window.getByTestId('intent-authorization-card');
  await expect(card).toBeVisible({ timeout: 5_000 });

  // Approve.
  await window.getByTestId('intent-approve-btn').click();

  // WS envelope captured.
  const env = await handles.waitForIntentAuth();
  expect(env).toBeTruthy();
  expect(env!.data).toEqual({ authorization_id: 'auth-stage4', approved: true });

  // Optimistic UI flip (badge text).
  await expect(card.getByText(/approved/i)).toBeVisible({ timeout: 2000 });

  // Server then pushes a success ack; the card must REMAIN in the
  // approved state (no flicker back to pending).
  await handles.server.pushTimeline(handles.server.getActiveSockets(), [
    {
      delayMs: 100,
      frame: { type: 'dialog.intent_authorize.success', data: { authorization_id: 'auth-stage4' } },
    },
  ]);
  await window.waitForTimeout(500);
  await expect(card.getByText(/approved/i)).toBeVisible();
});
