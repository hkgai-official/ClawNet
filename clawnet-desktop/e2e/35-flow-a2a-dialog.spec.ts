// e2e/35-flow-a2a-dialog.spec.ts
//
// Stage 5: A2A dialog flow — server pushes a dialog_approval rich-card,
// the responder (current user) clicks Approve, which fires the
// dialogs.approve IPC (POST /api/v1/agent-dialogs/:id/approve).
//
// This is the dialog-approval-card render-and-approve roundtrip. Refine
// + draft-update + submit-response are not exercised here because they
// require streaming draft text + dialog session state that the fake
// server only loosely supports. We verify the core approval IPC fires
// with the right payload.

import { test, expect } from '@playwright/test';
import { createGovernanceServer, login } from './fixtures/agent-governance-flow';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import type { GovernanceServerHandles } from './fixtures/agent-governance-flow';

let handles: GovernanceServerHandles;
let app: LaunchResult;
let approvalCalls: Array<{ sessionId: string; body: unknown }> = [];

test.beforeEach(async () => {
  approvalCalls = [];
  handles = await createGovernanceServer({
    'POST /api/v1/agent-dialogs/:id/approve': (req, res) => {
      approvalCalls.push({ sessionId: req.params.id as string, body: req.body });
      res.json({ data: { ok: true } });
    },
  });
  app = await launchApp({ serverURL: handles.server.url });
});

test.afterEach(async () => {
  await app.close();
  await handles.server.close();
});

test('Stage 35: dialog_approval card → Approve fires POST /agent-dialogs/:id/approve', async () => {
  const { window } = app;
  await login(window);
  await window.getByText('Helper Agent').first().click();
  await expect(window.getByPlaceholder(/Type a message/i)).toBeVisible({ timeout: 5_000 });

  // Push a dialog_approval rich-card. initiatorOwner.id MUST differ from
  // current user (u-e2e) — the card is initiator-skip rule'd inside
  // MessageBubble when the current user is the one who started the dialog.
  await handles.server.pushTimeline(handles.server.getActiveSockets(), [
    {
      delayMs: 100,
      frame: {
        type: 'push',
        topic: 'message.new',
        payload: {
          id: 'm-dialog-approval-1',
          conversation_id: 'c-agent',
          sender: { id: 'a-other', name: 'Other Agent', type: 'agent' },
          content_type: 'dialog_approval',
          content: {
            session_id: 'sess-1',
            topic: 'cross-team python sync',
            status: 'pending',
            initiator_agent: { id: 'a-other', display_name: 'Other Helper' },
            initiator_owner: { id: 'u-other', display_name: 'Bob' },
            my_agent: { id: 'a-helper', display_name: 'Helper' },
          },
          timestamp: '2026-05-14T00:00:12Z',
          status: 'sent',
        },
      },
    },
  ]);

  const card = window.getByTestId('dialog-approval-card');
  await expect(card).toBeVisible({ timeout: 5_000 });

  // The card surfaces "Authorize" / "Reject" buttons when status='pending'
  // and sessionId is present. Label is "✓ Authorize" so we match Authorize.
  await card.getByRole('button', { name: /Authorize/i }).click();

  // Wait for the POST.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (approvalCalls.length > 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(approvalCalls.length).toBeGreaterThan(0);
  expect(approvalCalls[0]!.sessionId).toBe('sess-1');
  expect(approvalCalls[0]!.body).toMatchObject({ approved: true });
});
