// e2e/44-a2a-reject-paths-fake.spec.ts
//
// Companion to spec 42 (which covers the APPROVE half of A2A). Tests
// the REJECT half — both sides' rejection paths:
//
//   1. alice clicks ✗ Deny on IntentAuthorizationCard → emits
//      `dialog.intent_authorize` WS envelope with approved=false, and
//      the card transitions to the rejected/denied visual state.
//
//   2. bob clicks ✗ Reject on DialogApprovalCard → POSTs
//      /api/v1/agent-dialogs/:id/approve with body { approved: false }.
//
// These paths existed in code (intent-deny-btn testid + Reject button
// in DialogApprovalCard) but had ZERO test coverage. Without them,
// regressions in rejection wiring would silently slip past CI.

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
const TOKEN_BOB = makeJwt('bob');
const USER_ALICE = { id: 'user-alice', name: 'Alice', code: 'C0001' };
const USER_BOB = { id: 'user-bob', name: 'Bob', code: 'C0002' };

let server: FakeServer;
let alice: LaunchResult;
let bob: LaunchResult;
// Records bodies POSTed to /agent-dialogs/:id/approve (used by the
// bob-rejects test to assert approved=false).
let approveBodies: Array<{ sessionId: string; body: Record<string, unknown> }> = [];

test.beforeEach(async () => {
  approveBodies = [];
  server = await startFakeServer({
    overrides: {
      'POST /api/v1/auth/login': (req, res) => {
        const email = (req.body as { email?: string }).email ?? '';
        const isAlice = email === 'alice';
        const tok = isAlice ? TOKEN_ALICE : TOKEN_BOB;
        const u = isAlice ? USER_ALICE : USER_BOB;
        res.json({
          data: {
            user: { id: u.id, display_name: u.name, user_code: u.code, email: `${email}@e2e.test` },
            tokens: { access_token: tok, refresh_token: `rt-${email}` },
          },
        });
      },
      'GET /api/v1/users/me': (req, res) => {
        const auth = (req.headers['authorization'] as string | undefined) ?? '';
        const isAlice = auth.includes(TOKEN_ALICE);
        const u = isAlice ? USER_ALICE : USER_BOB;
        res.json({
          data: { id: u.id, display_name: u.name, user_code: u.code, email: 'x@e2e.test', avatar: null },
        });
      },
      'GET /api/v1/conversations': (req, res) => {
        const auth = (req.headers['authorization'] as string | undefined) ?? '';
        const isAlice = auth.includes(TOKEN_ALICE);
        const u = isAlice ? USER_ALICE : USER_BOB;
        res.json({
          data: [
            {
              id: `c-default-${u.id}`,
              type: 'direct',
              participants: [
                { id: u.id, name: u.name, avatar: null, type: 'human', owner_id: null, owner_name: null, role: null },
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
      // Capture body so the dialog-reject test can assert approved=false.
      'POST /api/v1/agent-dialogs/:id/approve': (req, res) => {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        approveBodies.push({
          sessionId: id,
          body: req.body as Record<string, unknown>,
        });
        res.status(204).end();
      },
    },
  });
  alice = await launchApp({ serverURL: server.url });
  bob = await launchApp({ serverURL: server.url });
});

test.afterEach(async () => {
  await Promise.allSettled([alice.close(), bob.close()]);
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

test('alice rejects intent → outbound envelope carries approved=false', async () => {
  test.setTimeout(60_000);
  await login(alice.window, 'alice');
  await alice.window.getByText(/^Default/).first().click();

  await pushToToken(TOKEN_ALICE, {
    type: 'dialog.intent_authorization',
    data: {
      authorization_id: 'auth-reject-1',
      agent_name: 'Default',
      conversation_id: `c-default-${USER_ALICE.id}`,
      targets: [{ target_user_name: 'Bob', contact_tag_display_name: 'friends', topic: 'alice 想和你聊天' }],
    },
  });

  const card = alice.window.getByTestId('intent-authorization-card');
  await expect(card).toBeVisible({ timeout: 5_000 });
  await alice.window.getByTestId('intent-deny-btn').click();

  // Outbound envelope must have approved=false.
  let saw = false;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${server.url}/__test/received-frames`);
    const frames = (await res.json()) as Array<{ type?: string; data?: Record<string, unknown> }>;
    saw = frames.some(
      (f) =>
        f.type === 'dialog.intent_authorize' &&
        (f.data as { authorization_id?: string })?.authorization_id === 'auth-reject-1' &&
        (f.data as { approved?: boolean })?.approved === false,
    );
    if (saw) break;
    await alice.window.waitForTimeout(100);
  }
  expect(saw, 'alice must emit dialog.intent_authorize with approved=false').toBe(true);

  // Card should transition to a non-pending visual (status badge or
  // disabled buttons). The card's optimistic update flips `approved`
  // in local state — assert via the action buttons no longer being
  // clickable.
  await expect(alice.window.getByTestId('intent-deny-btn')).toBeHidden({ timeout: 3_000 });
});

test('bob rejects dialog approval → POSTs /approve with approved=false', async () => {
  test.setTimeout(60_000);
  await login(bob.window, 'bob');
  await bob.window.getByText(/^Default/).first().click();

  // Server pushes the dialog_approval card to bob.
  await pushToToken(TOKEN_BOB, {
    type: 'message.new',
    data: {
      id: 'm-dialog-approval-reject',
      conversation_id: `c-default-${USER_BOB.id}`,
      sender: { id: 'a-default', name: 'Default', type: 'agent' },
      content_type: 'dialog_approval',
      content: {
        session_id: 'sess-reject-1',
        topic: 'alice 想和你聊天',
        status: 'pending',
        initiator_agent: { id: 'a-default', display_name: 'Default' },
        initiator_owner: { id: USER_ALICE.id, display_name: USER_ALICE.name },
        my_agent: { id: 'a-default-bob', display_name: 'Default' },
      },
      timestamp: '2026-05-15T00:00:30Z',
      status: 'sent',
    },
  });

  const card = bob.window.getByTestId('dialog-approval-card');
  await expect(card).toBeVisible({ timeout: 5_000 });

  // Click Reject — DialogApprovalCard label is "✗ Reject".
  await bob.window.getByRole('button', { name: /Reject/i }).first().click();

  await expect(async () => {
    expect(approveBodies.length).toBeGreaterThan(0);
    expect(approveBodies[0]?.sessionId).toBe('sess-reject-1');
    expect(approveBodies[0]?.body.approved).toBe(false);
  }).toPass({ timeout: 3_000 });
});
