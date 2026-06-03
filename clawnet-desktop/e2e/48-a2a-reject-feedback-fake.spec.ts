// e2e/48-a2a-reject-feedback-fake.spec.ts
//
// Validates the initiator-side feedback when the OTHER party rejects
// the A2A dialog. Two assertions:
//
//   A. The IntentAuthorizationCard's `status` reflects the USER'S
//      decision (clicked Approve) — NOT the dialog outcome. macOS
//      `ChatEventHandler.swift:530-545` only flips this field on the
//      local click; we mirror that. The recipient's rejection
//      manifests as a per-target pill + toast, not as a card-level
//      "You denied" relabel (an earlier draft of PR #42 tried that
//      and conflated the two semantics — reverted in PR #44).
//
//   B. A global toast fires from `useDialogTerminationToast()` so the
//      user sees feedback regardless of which conversation they're in.
//
// Test persona: alice (Alice) is the initiator. bob's reject is
// simulated via direct fake-server WS pushes — no second window is
// needed for these assertions.

import { test, expect } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';

function makeJwt(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ exp, sub })).toString('base64url');
  return `${header}.${payload}.sig`;
}

const TOKEN_ALICE = makeJwt('alice');
const USER_ALICE = { id: 'user-alice', name: 'Alice', code: 'C0001' };

let server: FakeServer;
let alice: LaunchResult;

test.beforeEach(async () => {
  server = await startFakeServer({
    overrides: {
      'POST /api/v1/auth/login': (_req, res) => {
        res.json({
          data: {
            user: {
              id: USER_ALICE.id,
              display_name: USER_ALICE.name,
              user_code: USER_ALICE.code,
              email: 'alice@e2e.test',
            },
            tokens: { access_token: TOKEN_ALICE, refresh_token: 'rt-alice' },
          },
        });
      },
      'GET /api/v1/users/me': (_req, res) => {
        res.json({
          data: {
            id: USER_ALICE.id,
            display_name: USER_ALICE.name,
            user_code: USER_ALICE.code,
            email: 'alice@e2e.test',
            avatar: null,
          },
        });
      },
      'GET /api/v1/conversations': (_req, res) => {
        res.json({
          data: [
            {
              id: `c-default-${USER_ALICE.id}`,
              type: 'direct',
              participants: [
                { id: USER_ALICE.id, name: USER_ALICE.name, avatar: null, type: 'human', owner_id: null, owner_name: null, role: null },
                { id: 'a-default', name: 'Default', avatar: null, type: 'agent', owner_id: 'a-default-owner', owner_name: 'System', role: null },
              ],
              last_message_preview: 'Hello',
              last_message_at: '2026-05-15T00:00:00Z',
              unread_count: 0,
              created_at: '2026-05-01T00:00:00Z',
              updated_at: '2026-05-15T00:00:00Z',
              title: null,
              summary: null,
            },
          ],
        });
      },
      'GET /api/v1/conversations/:id/messages': (_req, res) => {
        res.json({ data: [], meta: { page: 1, page_size: 50, total: 0, has_more: false } });
      },
    },
  });
  alice = await launchApp({ serverURL: server.url });
});

test.afterEach(async () => {
  await Promise.allSettled([alice.close()]);
  await server.close();
});

async function login(window: LaunchResult['window'], account: string): Promise<void> {
  await window.getByLabel(/Account/i).fill(account);
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });
}

async function pushToToken(token: string, frame: unknown): Promise<void> {
  const res = await fetch(`${server.url}/__test/push-to-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, frame }),
  });
  if (!res.ok) throw new Error(`push-to-token failed: ${res.status} ${await res.text()}`);
}

test('initiator sees rejection toast when responder rejects; card status stays as user decision', async () => {
  test.setTimeout(60_000);
  await login(alice.window, 'alice');
  await alice.window.getByText(/^Default/).first().click();

  // ── Step 1: server pushes intent_authorization to alice ────────
  await pushToToken(TOKEN_ALICE, {
    type: 'dialog.intent_authorization',
    data: {
      authorization_id: 'auth-48-1',
      agent_name: 'Default',
      conversation_id: `c-default-${USER_ALICE.id}`,
      targets: [
        { target_user_name: 'Bob', contact_tag_display_name: 'friends', topic: 'rejection-feedback test' },
      ],
    },
  });
  const card = alice.window.getByTestId('intent-authorization-card');
  await expect(card).toBeVisible({ timeout: 5_000 });

  // ── Step 2: alice clicks Approve ───────────────────────────────
  await alice.window.getByTestId('intent-approve-btn').click();
  // Optimistic patch: PostActionResultRow shows the "authorized" copy.
  await expect(alice.window.getByText(/You authorized this request/i)).toBeVisible({
    timeout: 5_000,
  });

  // ── Step 3: bind sessionId → target via dialog.request.sent ──
  // Mirrors the server's behavior: once the intent is sent, the
  // initiator gets a request_sent frame so the targets slice can map
  // the future status_change events back to this card.
  // Wire topic uses UNDERSCORE (`dialog.request_sent`) and the inner
  // payload is snake_case — the main process runs deepSnakeToCamel and
  // re-broadcasts as the IPC channel `dialog.request.sent` (dots).
  await pushToToken(TOKEN_ALICE, {
    type: 'dialog.request_sent',
    data: {
      session_id: 'sess-48-rej',
      conversation_id: `c-default-${USER_ALICE.id}`,
      topic: 'rejection-feedback test',
      responder_owner: { id: 'user-bob', display_name: 'Bob' },
      responder_agent: { id: 'a-default-bob', display_name: 'Default' },
    },
  });

  // ── Step 4: bob rejects on their side → server pushes status_change
  await pushToToken(TOKEN_ALICE, {
    type: 'dialog.status_change',
    data: {
      session_id: 'sess-48-rej',
      conversation_id: `c-default-${USER_ALICE.id}`,
      old_status: 'pending_approval',
      new_status: 'terminated',
      reason: 'Owner rejected the dialog request',
      timestamp: new Date().toISOString(),
    },
  });

  // ── Assertion A: card status stays as the user's decision ────
  // The IntentAuthCard's `message.content.status` remains 'approved'
  // (the user did click Approve) — we do NOT flip it to 'denied' just
  // because the recipient rejected; that conflates two semantics.
  // Rejection feedback comes from the toast + per-target pill instead.
  await expect(alice.window.getByText(/You authorized this request/i)).toBeVisible({
    timeout: 5_000,
  });
  await expect(alice.window.getByText(/You denied this request/i)).toBeHidden();

  // ── Assertion B: global rejection toast appears ──────────────
  // `useDialogTerminationToast` keys off the structural transition
  // (oldStatus 'pending_approval' → 'terminated' = rejection).
  await expect(alice.window.getByText('The other party rejected the A2A dialog')).toBeVisible({
    timeout: 5_000,
  });
});

test('non-rejection terminate (owner_terminated) shows generic toast', async () => {
  test.setTimeout(60_000);
  await login(alice.window, 'alice');
  await alice.window.getByText(/^Default/).first().click();

  // Skip the IntentAuth flow — go straight to a session.terminated
  // push to verify the toast hook discriminates the reason correctly.
  await pushToToken(TOKEN_ALICE, {
    type: 'dialog.status_change',
    data: {
      session_id: 'sess-48-term',
      conversation_id: `c-default-${USER_ALICE.id}`,
      old_status: 'active',
      new_status: 'terminated',
      reason: 'owner_terminated',
      timestamp: new Date().toISOString(),
    },
  });

  await expect(alice.window.getByText('A2A dialog ended')).toBeVisible({ timeout: 5_000 });
  // The reject-flavored toast must NOT be shown for owner_terminated.
  await expect(alice.window.getByText('The other party rejected the A2A dialog')).toBeHidden();
});
