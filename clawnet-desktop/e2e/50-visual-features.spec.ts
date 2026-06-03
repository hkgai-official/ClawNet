// e2e/50-visual-features-alice.spec.ts
//
// Visual smoke run covering several features beyond the A2A reject flow
// (spec 49). NOT for CI — captured screenshots go to
// test-results/visual-features-alice/<test-slug>/. Operator (or me, via
// Read tool's image support) eyeballs them.

import { test, expect } from '@playwright/test';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
const OUT_ROOT = join(process.cwd(), 'test-results', 'visual-features-alice');

let server: FakeServer;
let alice: LaunchResult;
let tmp: string;

test.beforeEach(async ({}, testInfo) => {
  mkdirSync(join(OUT_ROOT, testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()), { recursive: true });
  tmp = mkdtempSync(join(tmpdir(), 'clawnet-visual-50-'));
});

test.afterEach(async () => {
  await Promise.allSettled([alice?.close()]);
  await server?.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function loginAlice(window: LaunchResult['window']) {
  await window.getByLabel(/Account/i).fill('alice');
  await window.getByLabel(/Password/i).fill('changeme');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });
}

function outDir(testInfo: { title: string }): string {
  return join(OUT_ROOT, testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
}

function aliceOverrides() {
  return {
    'POST /api/v1/auth/login': (_req: unknown, res: { json: (b: unknown) => void }) => {
      res.json({
        data: {
          user: { id: USER_ALICE.id, display_name: USER_ALICE.name, user_code: USER_ALICE.code, email: 'alice@e2e.test' },
          tokens: { access_token: TOKEN_ALICE, refresh_token: 'rt-alice' },
        },
      });
    },
    'GET /api/v1/users/me': (_req: unknown, res: { json: (b: unknown) => void }) => {
      res.json({
        data: { id: USER_ALICE.id, display_name: USER_ALICE.name, user_code: USER_ALICE.code, email: 'alice@e2e.test', avatar: null },
      });
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// 1. File upload — optimistic bubble appears before upload completes
// ────────────────────────────────────────────────────────────────────
test('file-upload-optimistic-bubble', async ({}, testInfo) => {
  test.setTimeout(60_000);
  server = await startFakeServer();
  alice = await launchApp({ serverURL: server.url });

  // big-ish PNG so the upload pipeline takes noticeable time vs. the
  // optimistic insert. Header bytes make MIME sniff as image/png.
  const file = join(tmp, 'red.png');
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeFileSync(file, Buffer.concat([PNG, Buffer.alloc(800 * 1024, 0xaa)]));

  // Default seeded fake-server has user `e2e@clawnet.test`, NOT alice —
  // use that path here to avoid customizing user fixtures for this
  // test. The optimistic-bubble behavior is per-renderer, not per-user.
  await alice.window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await alice.window.getByLabel(/Password/i).fill('any');
  await alice.window.getByRole('button', { name: /Sign in/i }).click();
  await expect(alice.window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });
  await alice.window.getByText('Helper Agent').first().click();
  await expect(alice.window.getByText('Hi there!').first()).toBeVisible();

  await alice.window.screenshot({ path: join(outDir(testInfo), '01-conv-open.png'), fullPage: true });

  // Fire chat.sendFile via preload bridge so we bypass the native picker.
  await alice.window.evaluate((path: string) => {
    const w = window as unknown as { clawnet: { invoke: (ch: string, p: unknown) => Promise<unknown> } };
    void w.clawnet.invoke('chat.sendFile', { conversationId: 'c-agent', localPath: path });
  }, file);

  // Optimistic image bubble should appear within ~1s — well before
  // the upload pipeline finishes its SHA + chunk POST.
  await expect(alice.window.getByTestId('image-bubble').last()).toBeVisible({ timeout: 3_000 });
  await alice.window.screenshot({ path: join(outDir(testInfo), '02-bubble-optimistic.png'), fullPage: true });

  // Wait for the post-upload swap to clawnet-file://{id}.
  await expect
    .poll(
      async () => {
        const src = await alice.window.getByTestId('image-bubble').last().locator('img').getAttribute('src');
        return src?.startsWith('clawnet-file://') ?? false;
      },
      { timeout: 10_000, message: 'image bubble never swapped to clawnet-file://' },
    )
    .toBe(true);
  await alice.window.screenshot({ path: join(outDir(testInfo), '03-bubble-swapped.png'), fullPage: true });
});

// ────────────────────────────────────────────────────────────────────
// 2. Text + Markdown send
// ────────────────────────────────────────────────────────────────────
test('text-and-markdown-send', async ({}, testInfo) => {
  test.setTimeout(60_000);
  server = await startFakeServer();
  alice = await launchApp({ serverURL: server.url });

  await alice.window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await alice.window.getByLabel(/Password/i).fill('any');
  await alice.window.getByRole('button', { name: /Sign in/i }).click();
  await expect(alice.window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });
  await alice.window.getByText('Helper Agent').first().click();

  const composer = alice.window.getByPlaceholder(/Type a message|输入消息/i);

  // Plain text
  await composer.fill('Hello from visual demo');
  await alice.window.screenshot({ path: join(outDir(testInfo), '01-composer-text.png'), fullPage: true });
  await composer.press('Enter');
  await expect(alice.window.getByText('Hello from visual demo').last()).toBeVisible({ timeout: 5_000 });
  await alice.window.screenshot({ path: join(outDir(testInfo), '02-text-sent.png'), fullPage: true });

  // Markdown — bold, italic, list, code
  const md = [
    '## Heading two',
    '',
    'This is **bold** and *italic*.',
    '',
    '- bullet one',
    '- bullet two',
    '',
    '```ts',
    'const x: number = 42;',
    '```',
  ].join('\n');
  await composer.fill(md);
  await composer.press('Shift+Enter');  // Shift+Enter should NOT send — keep multiline
  // Now actually send via the Send button
  await alice.window.getByRole('button', { name: /^Send$/i }).click();

  // The rendered message should contain at least the bullet items + code
  await expect(alice.window.getByText('bullet one').last()).toBeVisible({ timeout: 5_000 });
  await alice.window.screenshot({ path: join(outDir(testInfo), '03-markdown-rendered.png'), fullPage: true });
});

// ────────────────────────────────────────────────────────────────────
// 3. IME composition — Enter during composition must NOT send
// ────────────────────────────────────────────────────────────────────
test('ime-composition-enter-no-send', async ({}, testInfo) => {
  test.setTimeout(60_000);
  server = await startFakeServer();
  alice = await launchApp({ serverURL: server.url });

  await alice.window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await alice.window.getByLabel(/Password/i).fill('any');
  await alice.window.getByRole('button', { name: /Sign in/i }).click();
  await expect(alice.window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });
  await alice.window.getByText('Helper Agent').first().click();

  // Inject a synthetic keydown with `isComposing: true` and `key: 'Enter'`
  // — should be ignored by the composer per PR #36 (e.nativeEvent.isComposing
  // gate). After releasing composition, a real Enter should send.
  const composer = alice.window.getByPlaceholder(/Type a message|输入消息/i);
  await composer.fill('IME 测试');

  await alice.window.evaluate(() => {
    const ta = document.querySelector('textarea') as HTMLTextAreaElement | null;
    if (!ta) throw new Error('textarea not found');
    ta.focus();
    // Synthesize an isComposing Enter — the composer should ignore.
    const evt = new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
    });
    Object.defineProperty(evt, 'isComposing', { value: true });
    ta.dispatchEvent(evt);
  });
  await alice.window.waitForTimeout(300);
  // Composer still shows the text — proves no premature send.
  await expect(composer).toHaveValue('IME 测试');
  await alice.window.screenshot({ path: join(outDir(testInfo), '01-composing-not-sent.png'), fullPage: true });

  // Real Enter (no composition) — should send.
  await composer.press('Enter');
  await expect(alice.window.getByText('IME 测试').last()).toBeVisible({ timeout: 5_000 });
  await alice.window.screenshot({ path: join(outDir(testInfo), '02-after-real-enter.png'), fullPage: true });
});

// ────────────────────────────────────────────────────────────────────
// 4. Contacts panel
// ────────────────────────────────────────────────────────────────────
test('contacts-panel', async ({}, testInfo) => {
  server = await startFakeServer({
    overrides: {
      ...aliceOverrides(),
      'GET /api/v1/contacts': (_req: unknown, res: { json: (b: unknown) => void }) => {
        res.json({
          data: [
            { id: 'u-bob', display_name: 'Bob', user_code: 'C0002', avatar: null, status: 'online', remark: null },
            { id: 'u-cynthia', display_name: 'Cynthia', user_code: 'C0003', avatar: null, status: 'offline', remark: 'work friend' },
          ],
        });
      },
    },
  });
  alice = await launchApp({ serverURL: server.url });
  await loginAlice(alice.window);

  await alice.window.getByRole('button', { name: 'Contacts' }).click();
  await alice.window.waitForTimeout(500);
  await alice.window.screenshot({ path: join(outDir(testInfo), '01-contacts-panel.png'), fullPage: true });

  // The fake server seeds a pending friend request named "Charlie
  // Pending". Click it to surface whatever detail UI exists for a
  // pending request row.
  await alice.window.getByText('Charlie Pending').first().click().catch(() => undefined);
  await alice.window.waitForTimeout(300);
  await alice.window.screenshot({ path: join(outDir(testInfo), '02-contact-detail.png'), fullPage: true });

  // Open the Add Contact modal (+ button at top of the panel).
  await alice.window.getByTestId('add-contact-button').click().catch(async () => {
    // Fallback: any + icon button near the Contacts header.
    await alice.window.locator('aside button:has-text("+"), button[aria-label*="add" i]').first().click();
  });
  await alice.window.waitForTimeout(300);
  await alice.window.screenshot({ path: join(outDir(testInfo), '03-add-contact-modal.png'), fullPage: true });
});

// ────────────────────────────────────────────────────────────────────
// 5. Settings page
// ────────────────────────────────────────────────────────────────────
test('settings-pages', async ({}, testInfo) => {
  server = await startFakeServer({ overrides: aliceOverrides() });
  alice = await launchApp({ serverURL: server.url });
  await loginAlice(alice.window);

  await alice.window.getByRole('button', { name: 'Settings' }).click();
  await alice.window.waitForTimeout(500);
  await alice.window.screenshot({ path: join(outDir(testInfo), '01-settings-landing.png'), fullPage: true });

  // Tab through the visible sections.
  for (const label of [/Profile/i, /General/i, /Connection/i, /File access/i]) {
    const tab = alice.window.getByRole('tab', { name: label }).first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click();
      await alice.window.waitForTimeout(300);
      const slug = String(label).replace(/[^\w]+/g, '-').toLowerCase().replace(/\W/g, '');
      await alice.window.screenshot({ path: join(outDir(testInfo), `02-tab-${slug}.png`), fullPage: true });
    }
  }
});

// ────────────────────────────────────────────────────────────────────
// 6. A2A approve — responder side (alice receives DialogApprovalCard, clicks Authorize)
// ────────────────────────────────────────────────────────────────────
test('a2a-approve-as-responder', async ({}, testInfo) => {
  test.setTimeout(60_000);
  server = await startFakeServer({
    overrides: {
      ...aliceOverrides(),
      'GET /api/v1/conversations': (_req: unknown, res: { json: (b: unknown) => void }) => {
        res.json({
          data: [
            {
              id: `c-default-${USER_ALICE.id}`,
              type: 'direct',
              participants: [
                { id: USER_ALICE.id, name: USER_ALICE.name, avatar: null, type: 'human', owner_id: null, owner_name: null, role: null },
                { id: 'a-default', name: 'Default', avatar: null, type: 'agent', owner_id: 'a-default-owner', owner_name: 'System', role: null },
              ],
              last_message_preview: '欢迎',
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
      'GET /api/v1/conversations/:id/messages': (_req: unknown, res: { json: (b: unknown) => void }) => {
        res.json({ data: [], meta: { page: 1, page_size: 50, total: 0, has_more: false } });
      },
      'POST /api/v1/agent-dialogs/:id/approve': (_req: unknown, res: { status: (n: number) => { end: () => void } }) => {
        res.status(204).end();
      },
    },
  });
  alice = await launchApp({ serverURL: server.url });
  await loginAlice(alice.window);
  await alice.window.getByText(/^Default/).first().click();

  // Push the inbound dialog_approval message — alice is the responder
  // (someone else, simulated as bob, wants to chat).
  await fetch(`${server.url}/__test/push-to-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: TOKEN_ALICE,
      frame: {
        type: 'message.new',
        data: {
          id: 'm-dialog-approval-1',
          conversation_id: `c-default-${USER_ALICE.id}`,
          sender: { id: 'a-default', name: 'Default', type: 'agent' },
          content_type: 'dialog_approval',
          content: {
            session_id: 'sess-approve-vis',
            topic: '想跟你打个招呼',
            status: 'pending',
            initiator_agent: { id: 'a-default-bob', display_name: 'Default' },
            initiator_owner: { id: 'user-bob', display_name: 'Bob' },
            my_agent: { id: 'a-default-alice', display_name: 'Default' },
          },
          timestamp: new Date().toISOString(),
          status: 'sent',
        },
      },
    }),
  });

  const card = alice.window.getByTestId('dialog-approval-card');
  await expect(card).toBeVisible({ timeout: 5_000 });
  await alice.window.screenshot({ path: join(outDir(testInfo), '01-approval-card-pending.png'), fullPage: true });

  // Click Authorize (green primary button on DialogApprovalCard)
  await alice.window.getByRole('button', { name: /Authorize|授权/i }).first().click();
  await alice.window.waitForTimeout(500);
  await alice.window.screenshot({ path: join(outDir(testInfo), '02-after-authorize-click.png'), fullPage: true });

  // Server pushes the active state.
  await fetch(`${server.url}/__test/push-to-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: TOKEN_ALICE,
      frame: {
        type: 'dialog.status_change',
        data: {
          session_id: 'sess-approve-vis',
          conversation_id: `c-default-${USER_ALICE.id}`,
          old_status: 'pending_approval',
          new_status: 'active',
          timestamp: new Date().toISOString(),
        },
      },
    }),
  });
  await alice.window.waitForTimeout(800);
  await alice.window.screenshot({ path: join(outDir(testInfo), '03-dialog-active.png'), fullPage: true });
});
