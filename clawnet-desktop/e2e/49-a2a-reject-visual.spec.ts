// e2e/49-a2a-reject-visual-alice.spec.ts
//
// Visual smoke run for the A2A reject feedback fix on alice's account.
// NOT meant for CI — testIgnore'd via the filename pattern below.
// Outputs full-page screenshots at each key step under
// test-results/visual-alice/ so the operator (or me, via Read) can
// eyeball the UI states end-to-end.

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
const USER_ALICE = { id: 'user-alice', name: 'Alice', code: 'C0001' };

const OUT_DIR = join(process.cwd(), 'test-results', 'visual-alice');

let server: FakeServer;
let alice: LaunchResult;

test.beforeEach(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
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
              last_message_preview: '欢迎，Alice',
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
    },
  });
  alice = await launchApp({ serverURL: server.url });
});

test.afterEach(async () => {
  await Promise.allSettled([alice.close()]);
  await server.close();
});

async function pushToToken(frame: unknown): Promise<void> {
  const res = await fetch(`${server.url}/__test/push-to-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN_ALICE, frame }),
  });
  if (!res.ok) throw new Error(`push-to-token failed: ${res.status} ${await res.text()}`);
}

test('visual: alice initiates A2A, recipient rejects, full UI feedback chain', async () => {
  test.setTimeout(60_000);

  // ── Shot 1 — login screen ─────────────────────────────────
  await alice.window.screenshot({ path: join(OUT_DIR, '01-login.png'), fullPage: true });

  // ── Login as alice ──────────────────────────────────────────
  await alice.window.getByLabel(/Account/i).fill('alice');
  await alice.window.getByLabel(/Password/i).fill('changeme');
  await alice.window.getByRole('button', { name: /Sign in/i }).click();
  await expect(alice.window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  // ── Shot 2 — logged-in main shell ─────────────────────────
  await alice.window.screenshot({ path: join(OUT_DIR, '02-logged-in.png'), fullPage: true });

  // ── Open Default chat ────────────────────────────────────
  await alice.window.getByText(/^Default/).first().click();
  await alice.window.waitForTimeout(300);

  // ── Push intent_authorization → card appears ──────────────
  await pushToToken({
    type: 'dialog.intent_authorization',
    data: {
      authorization_id: 'auth-visual-1',
      agent_name: 'Default',
      conversation_id: `c-default-${USER_ALICE.id}`,
      targets: [
        { target_user_name: 'Bob', contact_tag_display_name: 'friends', topic: '想跟你打个招呼' },
      ],
    },
  });

  const card = alice.window.getByTestId('intent-authorization-card');
  await expect(card).toBeVisible({ timeout: 5_000 });

  // ── Shot 3 — IntentAuthCard, pending state ────────────────
  await alice.window.screenshot({ path: join(OUT_DIR, '03-intent-card-pending.png'), fullPage: true });

  // ── Click Approve ────────────────────────────────────────
  await alice.window.getByTestId('intent-approve-btn').click();
  await expect(alice.window.getByText(/You authorized this request/i)).toBeVisible({
    timeout: 5_000,
  });

  // ── Shot 4 — after Approve (optimistic patch applied) ────
  await alice.window.screenshot({ path: join(OUT_DIR, '04-after-approve.png'), fullPage: true });

  // ── Server binds session ─────────────────────────────────
  await pushToToken({
    type: 'dialog.request_sent',
    data: {
      session_id: 'sess-visual-1',
      conversation_id: `c-default-${USER_ALICE.id}`,
      topic: '想跟你打个招呼',
      responder_owner: { id: 'user-bob', display_name: 'Bob' },
      responder_agent: { id: 'a-default-bob', display_name: 'Default' },
    },
  });
  await alice.window.waitForTimeout(400);

  // ── Recipient rejects (server pushes dialog.status_change) ──
  await pushToToken({
    type: 'dialog.status_change',
    data: {
      session_id: 'sess-visual-1',
      conversation_id: `c-default-${USER_ALICE.id}`,
      old_status: 'pending_approval',
      new_status: 'terminated',
      reason: 'Owner rejected the dialog request',
      timestamp: new Date().toISOString(),
    },
  });

  // ── Wait for toast to render ─────────────────────────────
  await expect(alice.window.getByText('The other party rejected the A2A dialog')).toBeVisible({
    timeout: 5_000,
  });

  // ── Shot 5 — the money shot: rejection toast + card still says "You authorized"
  await alice.window.screenshot({ path: join(OUT_DIR, '05-reject-toast.png'), fullPage: true });

  // ── Sanity: card status unchanged (user did authorize) ────
  await expect(alice.window.getByText(/You authorized this request/i)).toBeVisible();
  await expect(alice.window.getByText(/You denied this request/i)).toBeHidden();

  // Wait for toast to auto-dismiss (4s default per toast-overlay)
  await alice.window.waitForTimeout(5_000);

  // ── Shot 6 — post-toast: per-target pill should show rejected ─
  await alice.window.screenshot({ path: join(OUT_DIR, '06-after-toast.png'), fullPage: true });
});
