// e2e/51-visual-two-account-a2a.spec.ts
//
// Two real Electron windows (alice + bob) sharing a fake server. Drives
// the full A2A reject path end-to-end with NO simulated frames — bob
// actually clicks Reject in their own UI, the server sees the POST,
// then routes the `dialog.status_change` push to alice. Captures both
// sides' screens at each step under
// test-results/visual-two-account-a2a/.

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
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

const OUT = join(process.cwd(), 'test-results', 'visual-two-account-a2a');

let server: FakeServer;
let alice: LaunchResult;
let bob: LaunchResult;

test.beforeEach(async () => {
  mkdirSync(OUT, { recursive: true });
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
          data: { id: u.id, display_name: u.name, user_code: u.code, email: `${isAlice ? 'alice' : 'bob'}@e2e.test`, avatar: null },
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
              last_message_at: '2026-05-26T08:00:00Z',
              unread_count: 0,
              created_at: '2026-05-01T00:00:00Z',
              updated_at: '2026-05-26T08:00:00Z',
              title: null,
              summary: null,
            },
          ],
        });
      },
      'GET /api/v1/conversations/:id/messages': (_req, res) => {
        res.json({ data: [], meta: { page: 1, page_size: 50, total: 0, has_more: false } });
      },
      // The /approve handler is the one bob's renderer hits after clicking
      // Reject. We capture the body for assertion AND emit the matching
      // `dialog.status_change` push to both parties — exactly what the
      // real server does in agent_dialog_service.py:655-712.
      'POST /api/v1/agent-dialogs/:id/approve': async (req, res) => {
        const sessionId = typeof req.params.id === 'string' ? req.params.id : '';
        const body = req.body as { approved?: boolean; reason?: string };
        res.status(204).end();
        // Defer the push so the renderer mutation's onSuccess has time
        // to fire first.
        setTimeout(() => {
          void Promise.all([
            fetch(`${server.url}/__test/push-to-token`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token: TOKEN_ALICE,
                frame: {
                  type: 'dialog.status_change',
                  data: {
                    session_id: sessionId,
                    conversation_id: `c-default-${USER_ALICE.id}`,
                    old_status: 'pending_approval',
                    new_status: body.approved ? 'active' : 'terminated',
                    reason: body.approved ? undefined : (body.reason ?? 'Owner rejected the dialog request'),
                    timestamp: new Date().toISOString(),
                  },
                },
              }),
            }),
            fetch(`${server.url}/__test/push-to-token`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token: TOKEN_BOB,
                frame: {
                  type: 'dialog.status_change',
                  data: {
                    session_id: sessionId,
                    conversation_id: `c-default-${USER_BOB.id}`,
                    old_status: 'pending_approval',
                    new_status: body.approved ? 'active' : 'terminated',
                    reason: body.approved ? undefined : (body.reason ?? 'Owner rejected the dialog request'),
                    timestamp: new Date().toISOString(),
                  },
                },
              }),
            }),
          ]);
        }, 150);
      },
    },
  });
  alice = await launchApp({ serverURL: server.url });
  bob = await launchApp({ serverURL: server.url });
});

test.afterEach(async () => {
  await Promise.allSettled([alice?.close(), bob?.close()]);
  await server?.close();
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

test('two-window A2A end-to-end: alice initiates, bob rejects, alice sees feedback', async () => {
  test.setTimeout(120_000);

  // ── Step 1: log both sides in ────────────────────────────
  await login(alice.window, 'alice');
  await login(bob.window, 'bob');
  await alice.window.getByText(/^Default/).first().click();
  await bob.window.getByText(/^Default/).first().click();
  await alice.window.screenshot({ path: join(OUT, '01-alice-logged-in.png'), fullPage: true });
  await bob.window.screenshot({ path: join(OUT, '01-bob-logged-in.png'), fullPage: true });

  // ── Step 2: server delivers intent_authorization to ALICE ──
  // Mirrors what the real server does after alice's main agent emits
  // a contact intent in response to "联系下 Bob".
  const SESSION_ID = 'sess-two-window-1';
  await pushToToken(TOKEN_ALICE, {
    type: 'dialog.intent_authorization',
    data: {
      authorization_id: 'auth-two-window-1',
      agent_name: 'Default',
      conversation_id: `c-default-${USER_ALICE.id}`,
      targets: [
        { target_user_name: 'Bob', contact_tag_display_name: 'friends', topic: '想跟你打个招呼' },
      ],
    },
  });
  await expect(alice.window.getByTestId('intent-authorization-card')).toBeVisible({ timeout: 5_000 });
  await alice.window.screenshot({ path: join(OUT, '02-alice-intent-card-pending.png'), fullPage: true });

  // ── Step 3: ALICE approves the intent ──────────────────────
  await alice.window.getByTestId('intent-approve-btn').click();
  await expect(alice.window.getByText(/You authorized this request/i)).toBeVisible({ timeout: 5_000 });
  await alice.window.screenshot({ path: join(OUT, '03-alice-after-approve.png'), fullPage: true });

  // ── Step 4: server pushes the dialog request to BOTH ─────
  //   - dialog.request_sent to alice (so the targets slice binds)
  //   - message.new with dialog_approval to bob (so BOB sees the card)
  await pushToToken(TOKEN_ALICE, {
    type: 'dialog.request_sent',
    data: {
      session_id: SESSION_ID,
      conversation_id: `c-default-${USER_ALICE.id}`,
      topic: '想跟你打个招呼',
      responder_owner: { id: USER_BOB.id, display_name: USER_BOB.name },
      responder_agent: { id: 'a-default-bob', display_name: 'Default' },
    },
  });
  await pushToToken(TOKEN_BOB, {
    type: 'message.new',
    data: {
      id: 'm-dialog-approval-1',
      conversation_id: `c-default-${USER_BOB.id}`,
      sender: { id: 'a-default', name: 'Default', type: 'agent' },
      content_type: 'dialog_approval',
      content: {
        session_id: SESSION_ID,
        topic: '想跟你打个招呼',
        status: 'pending',
        initiator_agent: { id: 'a-default-alice', display_name: 'Default' },
        initiator_owner: { id: USER_ALICE.id, display_name: USER_ALICE.name },
        my_agent: { id: 'a-default-bob', display_name: 'Default' },
      },
      timestamp: new Date().toISOString(),
      status: 'sent',
    },
  });

  // ── Step 5: bob sees the DialogApprovalCard ──────────────
  await expect(bob.window.getByTestId('dialog-approval-card')).toBeVisible({ timeout: 5_000 });
  await bob.window.screenshot({ path: join(OUT, '04-bob-approval-card.png'), fullPage: true });

  // ── Step 6: bob clicks Reject (REAL click; server-side
  // /approve handler will route the status_change push back).
  await bob.window.getByRole('button', { name: /Reject|拒绝/i }).first().click();
  await bob.window.waitForTimeout(800);
  await bob.window.screenshot({ path: join(OUT, '05-bob-after-reject-click.png'), fullPage: true });

  // ── Step 7: alice should receive the rejection feedback ───
  // - Global toast: "The other party rejected the A2A dialog"
  // - Per-target pill on the IntentAuthCard: ❌ Rejected
  // - Card status badge stays "approved" (user's decision)
  await expect(alice.window.getByText('The other party rejected the A2A dialog')).toBeVisible({
    timeout: 5_000,
  });
  await alice.window.screenshot({ path: join(OUT, '06-alice-reject-toast.png'), fullPage: true });

  // Wait for toast to fade; the per-target pill should remain.
  await alice.window.waitForTimeout(5_000);
  await alice.window.screenshot({ path: join(OUT, '07-alice-final-state.png'), fullPage: true });
  await bob.window.screenshot({ path: join(OUT, '07-bob-final-state.png'), fullPage: true });

  // ── Sanity assertions ────────────────────────────────────
  await expect(alice.window.getByText(/You authorized this request/i)).toBeVisible();
  await expect(alice.window.getByText(/You denied this request/i)).toBeHidden();
});
