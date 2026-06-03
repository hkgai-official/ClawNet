// e2e/42-two-user-a2a-fake.spec.ts
//
// Two-user A2A flow against the fake-server (NOT prod). Solves the
// "only one Mac available" testing constraint by letting us route
// pushes per-user via the fake-server's `/__test/push-to-token`
// endpoint.
//
// What this verifies vs. the round-7 push-topic audit:
//   - alice receives `dialog.intent_authorization` push → renders
//     IntentAuthorizationCard (commit 8bcf9f5).
//   - Clicking Approve emits the `dialog.intent_authorize` WS envelope
//     with the correct payload (round-5 #B1, verified again here).
//   - bob receives a `message.new` with `content_type='dialog_approval'`
//     and renders the responder-side DialogApprovalCard.
//
// All flowing through real Electron + real ChatEventHandler + real
// ChatService — only the server-side push routing is fake. End-to-end
// confidence without depending on prod env constraints.

import { test, expect } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';

// Real-format JWTs (HS256 header, exp ~1h out, distinguishable `sub`) so
// the client's `ensureValidAccessToken` doesn't think they're expired and
// trigger a refresh — which would then fall through to the default
// fake-server refresh handler and overwrite our per-user token.
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

test.beforeEach(async () => {
  server = await startFakeServer({
    overrides: {
      // Per-account login: return a token whose value encodes the
      // account, so the WS routing layer can target push frames at
      // exactly one client. Also vary the user payload so each side
      // sees its own profile.
      'POST /api/v1/auth/login': (req, res) => {
        // Client sends `{email, password}` (auth-manager.ts:74). The
        // login form labels the field "Account" but the value goes into
        // `email`. We sniff that to figure out which user is logging in.
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
      // /me must match the logged-in account. We use a sneaky header
      // lookup: fake-server's HttpClient sends the access_token as
      // bearer, so we can read it back to figure out who's calling.
      'GET /api/v1/users/me': (req, res) => {
        const auth = (req.headers['authorization'] as string | undefined) ?? '';
        const isAlice = auth.includes(TOKEN_ALICE);
        const u = isAlice ? USER_ALICE : USER_BOB;
        res.json({
          data: {
            id: u.id,
            display_name: u.name,
            user_code: u.code,
            email: `${isAlice ? 'alice' : 'bob'}@e2e.test`,
            avatar: null,
          },
        });
      },
      // Both users see one conversation with "Default" agent. Conv id
      // is per-user so the conversation graph stays clean.
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
              last_message_at: '2026-05-14T00:00:00Z',
              unread_count: 0,
              created_at: '2026-05-01T00:00:00Z',
              updated_at: '2026-05-14T00:00:00Z',
              title: null,
              summary: null,
            },
          ],
        });
      },
      // Empty message history for both.
      'GET /api/v1/conversations/:id/messages': (_req, res) => {
        res.json({ data: [], meta: { page: 1, page_size: 50, total: 0, has_more: false } });
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
  if (!res.ok) {
    throw new Error(`push-to-token failed: ${res.status} ${await res.text()}`);
  }
}

test('A2A: alice approves intent → bob sees dialog_approval card', async () => {
  test.setTimeout(120_000);

  // Login both sides.
  await login(alice.window, 'alice');
  await login(bob.window, 'bob');

  // Both open their Default conversation.
  await alice.window.getByText(/^Default/).first().click();
  await expect(alice.window.getByPlaceholder(/Type a message|输入消息/i)).toBeVisible({
    timeout: 5_000,
  });
  await bob.window.getByText(/^Default/).first().click();
  await expect(bob.window.getByPlaceholder(/Type a message|输入消息/i)).toBeVisible({
    timeout: 5_000,
  });

  // ── Simulate server emitting `dialog.intent_authorization` to alice ──
  await pushToToken(TOKEN_ALICE, {
    type: 'dialog.intent_authorization',
    data: {
      authorization_id: 'auth-fake-1',
      agent_name: 'Default',
      conversation_id: `c-default-${USER_ALICE.id}`,
      targets: [
        {
          target_user_name: 'Bob',
          contact_tag_display_name: 'friends',
          topic: 'alice 想和你聊天',
        },
      ],
    },
  });

  // ── alice side: IntentAuthorizationCard should render ──
  const aliceCard = alice.window.getByTestId('intent-authorization-card');
  await expect(aliceCard, 'alice should see intent_authorization card').toBeVisible({
    timeout: 5_000,
  });
  await expect(aliceCard.getByText(/Bob/)).toBeVisible();

  // ── alice clicks Approve → emits dialog.intent_authorize envelope ──
  await alice.window.getByTestId('intent-approve-btn').click();

  // Wait for the outgoing envelope to land in the fake-server's
  // received-frames log.
  let intentApproveSent = false;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${server.url}/__test/received-frames`);
    const frames = (await res.json()) as Array<{ type?: string; data?: Record<string, unknown> }>;
    if (
      frames.some(
        (f) =>
          f.type === 'dialog.intent_authorize' &&
          (f.data as { authorization_id?: string })?.authorization_id === 'auth-fake-1' &&
          (f.data as { approved?: boolean })?.approved === true,
      )
    ) {
      intentApproveSent = true;
      break;
    }
    await alice.window.waitForTimeout(100);
  }
  expect(intentApproveSent, 'alice must emit dialog.intent_authorize envelope').toBe(true);

  // ── Simulate server side: now push dialog_approval to bob ──
  // Server would normally do this after receiving alice's authorize.
  await pushToToken(TOKEN_BOB, {
    type: 'message.new',
    data: {
      id: 'm-dialog-approval-fake',
      conversation_id: `c-default-${USER_BOB.id}`,
      sender: { id: 'a-default', name: 'Default', type: 'agent' },
      content_type: 'dialog_approval',
      content: {
        session_id: 'sess-fake-1',
        topic: 'alice 想和你聊天',
        status: 'pending',
        initiator_agent: { id: 'a-default', display_name: 'Default' },
        initiator_owner: { id: USER_ALICE.id, display_name: USER_ALICE.name },
        my_agent: { id: 'a-default-bob', display_name: 'Default' },
      },
      timestamp: '2026-05-14T00:00:30Z',
      status: 'sent',
    },
  });

  // ── bob side: DialogApprovalCard should render ──
  const bobCard = bob.window.getByTestId('dialog-approval-card');
  await expect(bobCard, 'bob should see dialog_approval card').toBeVisible({
    timeout: 5_000,
  });
  // Initiator is Alice (alice's display name).
  await expect(bobCard.getByText(/Alice/)).toBeVisible();

  // ── Final confirmation: alice's card should now show the optimistic
  // approved status (round-5 #B1 optimistic update). ──
  await expect(aliceCard.getByText(/approved/i)).toBeVisible({ timeout: 3_000 });
});
