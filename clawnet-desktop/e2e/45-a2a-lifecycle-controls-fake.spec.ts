// e2e/45-a2a-lifecycle-controls-fake.spec.ts
//
// Coverage for `AgentDialogControlBar` — the inline bar shown above
// the composer during an active A2A dialog. Exercises the two
// owner-driven control flows that had ZERO test coverage before:
//
//   1. Extend → enter N rounds → Confirm → POST /extend with
//      { additionalRounds: N }
//   2. Terminate → confirm → POST /terminate with
//      { reason: 'owner_terminated' }
//
// Status-badge transition on dialog.status_change push is asserted as
// a bonus — it covers the IPC plumbing that delivers state updates to
// the control bar.

import { test, expect } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';

const SESSION_ID = 'sess-lifecycle-1';
const DIALOG_CONV_ID = 'c-fake-dialog-lifecycle';
const ME_ID = 'u-e2e';

let server: FakeServer;
let app: LaunchResult;
let extendBodies: Array<{ sessionId: string; body: Record<string, unknown> }> = [];
let terminateBodies: Array<{ sessionId: string; body: Record<string, unknown> }> = [];

test.beforeEach(async () => {
  extendBodies = [];
  terminateBodies = [];
  server = await startFakeServer({
    overrides: {
      'GET /api/v1/conversations': (_req, res) => {
        res.json({
          data: [
            {
              id: DIALOG_CONV_ID,
              type: 'direct',
              participants: [
                { id: ME_ID, name: 'E2E User', type: 'human' },
                { id: 'a-bob', name: 'Bob Agent', type: 'agent' },
              ],
              last_message_preview: '',
              last_message_at: '2026-05-15T00:00:00Z',
              unread_count: 0,
              created_at: '2026-05-15T00:00:00Z',
              updated_at: '2026-05-15T00:00:00Z',
            },
          ],
        });
      },
      'GET /api/v1/conversations/:id/messages': (_req, res) => {
        res.json({ data: [], meta: { page: 1, page_size: 50, total: 0, has_more: false } });
      },
      'GET /api/v1/agent-dialogs/by-conversation/:id': (req, res) => {
        if (req.params.id !== DIALOG_CONV_ID) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        res.json({
          data: {
            id: SESSION_ID,
            initiator_agent: { id: 'a-alice', display_name: 'Default' },
            responder_agent: { id: 'a-bob', display_name: 'Bob Agent' },
            initiator_owner: { id: ME_ID, display_name: 'E2E User' },
            responder_owner: { id: 'u-bob', display_name: 'Bob' },
            topic: 'lifecycle test dialog',
            status: 'active',
            current_round: 0,
            max_rounds: 5,
            conversation_id: DIALOG_CONV_ID,
            created_at: '2026-05-15T00:00:00Z',
          },
        });
      },
      'POST /api/v1/agent-dialogs/:id/extend': (req, res) => {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        extendBodies.push({ sessionId: id, body: req.body as Record<string, unknown> });
        res.status(204).end();
      },
      'POST /api/v1/agent-dialogs/:id/terminate': (req, res) => {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        terminateBodies.push({ sessionId: id, body: req.body as Record<string, unknown> });
        res.status(204).end();
      },
    },
  });
  app = await launchApp({ serverURL: server.url });
});

test.afterEach(async () => {
  await app.close();
  await server.close();
});

async function openDialog(): Promise<void> {
  await app.window.getByLabel(/Account/i).fill('alice');
  await app.window.getByLabel(/Password/i).fill('any');
  await app.window.getByRole('button', { name: /Sign in/i }).click();
  await expect(app.window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });
  await app.window.getByText(/Bob Agent/).first().click();
  // ControlBar mounts when the active conv has a dialog session — assert
  // visible via the topic text it surfaces.
  await expect(app.window.getByText(/lifecycle test dialog/)).toBeVisible({ timeout: 5_000 });
}

test('Extend: enter rounds → Confirm → POST /extend with additionalRounds', async () => {
  await openDialog();

  await app.window.getByRole('button', { name: /Extend/i }).click();
  // Input next to the prefix "Add". Default value is 5 — override to 3.
  const rounds = app.window.locator('input[type="number"]').first();
  await rounds.fill('3');
  await app.window.getByRole('button', { name: /^Confirm$/i }).click();

  await expect(async () => {
    expect(extendBodies.length).toBeGreaterThan(0);
    expect(extendBodies[0]?.sessionId).toBe(SESSION_ID);
    // HttpClient converts camelCase → snake_case on outgoing wire.
    expect(extendBodies[0]?.body.additional_rounds).toBe(3);
  }).toPass({ timeout: 3_000 });
});

test('Terminate: confirm dialog → POST /terminate with reason=owner_terminated', async () => {
  await openDialog();

  await app.window.getByRole('button', { name: /Terminate/i }).click();
  // After clicking Terminate, an inline confirm row appears with a red
  // "End dialog" primary button. Click it.
  await app.window.getByRole('button', { name: /End dialog/i }).click();

  await expect(async () => {
    expect(terminateBodies.length).toBeGreaterThan(0);
    expect(terminateBodies[0]?.sessionId).toBe(SESSION_ID);
    expect(terminateBodies[0]?.body.reason).toBe('owner_terminated');
  }).toPass({ timeout: 3_000 });
});

test('Terminate confirm row → Cancel keeps dialog active', async () => {
  await openDialog();

  await app.window.getByRole('button', { name: /Terminate/i }).click();
  // The confirm message becomes visible.
  await expect(app.window.getByText(/End this dialog now/i)).toBeVisible();
  await app.window.getByRole('button', { name: /^Cancel$/i }).click();

  // No terminate POST should have fired.
  await app.window.waitForTimeout(500);
  expect(terminateBodies.length).toBe(0);
  // Terminate button is back (we're out of the confirm sub-state).
  await expect(app.window.getByRole('button', { name: /Terminate/i })).toBeVisible();
});

test('multi-round: server pushes dialog.round_complete → control bar round counter updates', async () => {
  test.setTimeout(30_000);
  await openDialog();

  // ControlBar renders `{displayRound}/{displayMaxRounds}` in a single
  // span. displayRound = floor((currentRound+1)/2); displayMaxRounds =
  // floor((maxRounds+1)/2). Setup uses current_round=0, max=5 → "0/3".
  await expect(app.window.locator('text=/^0\\/3$/').first()).toBeVisible({
    timeout: 5_000,
  });

  // Push dialog.round_complete advancing currentRound to 3 →
  // floor((3+1)/2) = 2 → "2/3".
  await fetch(`${server.url}/__test/push-frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      frame: {
        type: 'dialog.round_complete',
        data: { session_id: SESSION_ID, current_round: 3, max_rounds: 5 },
      },
    }),
  });

  await expect(app.window.locator('text=/^2\\/3$/').first()).toBeVisible({
    timeout: 5_000,
  });
});

test('multi-round: server pushes status=completed → control bar marks dialog complete', async () => {
  test.setTimeout(30_000);
  await openDialog();

  await fetch(`${server.url}/__test/push-frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      frame: {
        type: 'dialog.status_change',
        data: {
          session_id: SESSION_ID,
          old_status: 'active',
          new_status: 'completed',
          current_round: 5,
          max_rounds: 5,
        },
      },
    }),
  });

  // Once status is non-active/non-paused, the action buttons disappear
  // (the `canAct` gate in agent-dialog-control-bar.tsx:37). Extend +
  // Terminate are no longer shown.
  await expect(app.window.getByRole('button', { name: /Extend/i })).toBeHidden({
    timeout: 5_000,
  });
  await expect(app.window.getByRole('button', { name: /Terminate/i })).toBeHidden();
});

test('WS disconnect mid-dialog → state survives reconnect', async () => {
  test.setTimeout(60_000);
  await openDialog();

  // Sanity: control bar is up and Extend is interactive.
  await expect(app.window.getByRole('button', { name: /Extend/i })).toBeVisible();

  // Force-close the WS from the server. ConnectionManager's reconnect
  // loop will pick it up.
  for (const s of server.getActiveSockets()) s.terminate();
  await expect(app.window.getByLabel(/Connection Reconnecting/i)).toBeVisible({ timeout: 8_000 });
  await expect(app.window.getByLabel(/Connection Connected/i)).toBeVisible({ timeout: 30_000 });

  // Dialog session state survives — control bar still shows the
  // active session and its actions are still wired. Click Extend +
  // Confirm to prove the IPC chain works post-reconnect.
  await expect(app.window.getByText(/lifecycle test dialog/)).toBeVisible();
  await app.window.getByRole('button', { name: /Extend/i }).click();
  await app.window.locator('input[type="number"]').first().fill('2');
  await app.window.getByRole('button', { name: /^Confirm$/i }).click();

  await expect(async () => {
    expect(extendBodies.length).toBeGreaterThan(0);
    expect(extendBodies[0]?.body.additional_rounds).toBe(2);
  }).toPass({ timeout: 3_000 });
});
