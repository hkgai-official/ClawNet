// e2e/33-flow-discovery-start.spec.ts
//
// Stage 3: a discovery task card appears in the active conversation and
// the user confirms it. Asserts:
//   - all three sub-sections (pending, active, completed) render when
//     the payload includes them,
//   - clicking Confirm fires POST /api/v1/agent-discovery/:id/confirm.

import { test, expect } from '@playwright/test';
import { createGovernanceServer, login } from './fixtures/agent-governance-flow';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import type { GovernanceServerHandles } from './fixtures/agent-governance-flow';

let handles: GovernanceServerHandles;
let app: LaunchResult;

const TASK_PAYLOAD = {
  id: 'task-disc-1',
  source_conversation_id: 'c-agent',
  initiator_agent_id: 'a-helper',
  initiator_owner_id: 'u-e2e',
  status: 'pending_confirmation',
  original_intent: 'find a python expert',
  max_hops: 3,
  current_hop_count: 1,
  max_concurrent: 2,
  pending_queries: [
    { target_owner: 'Alice', topic: 'python' },
    { target_owner: 'Bob', topic: 'machine learning' },
  ],
  completed_results: [],
  active_sessions: [],
  created_at: '2026-05-14T00:00:00Z',
  updated_at: '2026-05-14T00:00:00Z',
  completed_at: null,
};

test.beforeEach(async () => {
  handles = await createGovernanceServer({
    'GET /api/v1/discovery-tasks/by-conversation/:id': (req, res) => {
      if (req.params.id === 'c-agent') {
        res.json({ data: TASK_PAYLOAD });
      } else {
        res.status(404).end();
      }
    },
  });
  app = await launchApp({ serverURL: handles.server.url });
});

test.afterEach(async () => {
  await app.close();
  await handles.server.close();
});

test('Stage 33: discovery task renders + Confirm fires correct IPC', async () => {
  const { window } = app;
  await login(window);
  await window.getByText('Helper Agent').first().click();
  // Wait for the message list to actually mount (composer visible →
  // conversation is open).
  await expect(window.getByPlaceholder(/Type a message/i)).toBeVisible({ timeout: 5_000 });
  await expect(window.getByText('Hi there!').first()).toBeVisible({ timeout: 3_000 });

  // DiscoveryTaskCard is gated by a message of content_type=discovery_progress
  // in the conversation (message-bubble.tsx:126). Push one in via the
  // server-proxied `message.new` topic — the legacy `chat.message.created`
  // pushChatMessage helper still uses the old topic name that
  // ChatEventHandler no longer subscribes to.
  await handles.server.pushTimeline(handles.server.getActiveSockets(), [
    {
      delayMs: 100,
      frame: {
        type: 'push',
        topic: 'message.new',
        payload: {
          id: 'm-discovery-1',
          conversation_id: 'c-agent',
          sender: { id: 'system', name: 'system', type: 'system' },
          content_type: 'discovery_progress',
          content: { task_id: 'task-disc-1' },
          timestamp: '2026-05-14T00:00:30Z',
          status: 'sent',
        },
      },
    },
  ]);

  const card = window.getByTestId('discovery-task-card');
  await expect(card).toBeVisible({ timeout: 5_000 });

  // Title + intent text.
  await expect(card.getByText(/Multi-user discovery/i)).toBeVisible();
  await expect(card.getByText('find a python expert')).toBeVisible();

  // Pending sub-list shows both queries.
  await expect(card.getByText(/Alice/)).toBeVisible();
  await expect(card.getByText(/Bob/)).toBeVisible();

  // Confirm button click → POST /api/v1/agent-discovery/:id/confirm.
  await card.getByRole('button', { name: /Confirm execution/i }).click();

  let confirm: { id: string; body: unknown } | null = null;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    confirm = await handles.getLastDiscoveryConfirm();
    if (confirm) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(confirm, 'POST /agent-discovery/:id/confirm not observed').toBeTruthy();
  expect(confirm!.id).toBe('task-disc-1');
});
