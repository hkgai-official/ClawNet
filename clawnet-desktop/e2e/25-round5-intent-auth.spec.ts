// e2e/25-round5-intent-auth.spec.ts
//
// Round-5 M #B1: IntentAuthorization card now has functional Approve /
// Deny buttons (previously read-only). Click semantics mirror macOS
// ChatService.intentAuthorize (ChatService.swift:1013-1031):
//   - Send a `dialog.intent_authorize` WS envelope with
//     {authorization_id, approved}
//   - Optimistically flip the local card status to "approved" / "denied"
//     so the user doesn't have to wait for a server push.
//
// We also verify the main-agent variant shows a single "Understood"
// button instead of Approve+Deny (macOS RichCardViews.swift:437).

import { test, expect } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import { INTENT_AUTH_TIMELINE } from './fixtures/stream-script';

let server: FakeServer;
let app: LaunchResult;

test.beforeEach(async () => {
  server = await startFakeServer();
  app = await launchApp({ serverURL: server.url });
});

test.afterEach(async () => {
  await app.close();
  await server.close();
});

async function loginAndOpenAgent(app: LaunchResult) {
  const { window } = app;
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });
  await window.getByText('Helper Agent').first().click();
}

async function getReceivedFrames(server: FakeServer): Promise<unknown[]> {
  const res = await fetch(`${server.url}/__test/received-frames`);
  return res.json() as Promise<unknown[]>;
}

async function waitForFrame(
  server: FakeServer,
  predicate: (f: unknown) => boolean,
  timeoutMs = 5000,
): Promise<unknown | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frames = await getReceivedFrames(server);
    const found = frames.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test('M #B1: Approve sends dialog.intent_authorize + flips card status optimistically', async () => {
  const { window } = app;
  await loginAndOpenAgent(app);

  // Push the intent_authorization rich-card.
  await server.pushTimeline(server.getActiveSockets(), INTENT_AUTH_TIMELINE);

  // Card mounts: pending badge + Approve / Deny buttons visible.
  const card = window.getByTestId('intent-authorization-card');
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect(window.getByTestId('intent-approve-btn')).toBeVisible();
  await expect(window.getByTestId('intent-deny-btn')).toBeVisible();

  await window.getByTestId('intent-approve-btn').click();

  // WS envelope assertion.
  const frame = (await waitForFrame(server, (f) => {
    const x = f as { type?: string };
    return x.type === 'dialog.intent_authorize';
  })) as { type: string; data: { authorization_id: string; approved: boolean } } | null;
  expect(frame, 'dialog.intent_authorize envelope not received').toBeTruthy();
  expect(frame!.data).toEqual({ authorization_id: 'auth-1', approved: true });

  // Optimistic update: the status badge should flip from `pending` →
  // `approved` without any server push. The card uses an i18n key
  // `intentStatus.approved` with defaultValue 'approved'.
  await expect(card.getByText(/approved/i)).toBeVisible({ timeout: 2000 });
});

test('M #B1: Deny sends approved:false', async () => {
  const { window } = app;
  await loginAndOpenAgent(app);

  await server.pushTimeline(server.getActiveSockets(), INTENT_AUTH_TIMELINE);
  await expect(window.getByTestId('intent-authorization-card')).toBeVisible({ timeout: 5000 });
  await window.getByTestId('intent-deny-btn').click();

  const frame = (await waitForFrame(server, (f) => {
    const x = f as { type?: string };
    return x.type === 'dialog.intent_authorize';
  })) as { type: string; data: { authorization_id: string; approved: boolean } } | null;
  expect(frame!.data).toEqual({ authorization_id: 'auth-1', approved: false });
});

test('M #B1: main-agent variant shows Understood (single button, no Approve)', async () => {
  const { window } = app;
  await loginAndOpenAgent(app);

  // Push a main-agent flavored card.
  const MAIN_AGENT_AUTH: Array<{ delayMs: number; frame: unknown }> = [
    {
      delayMs: 200,
      frame: {
        type: 'push',
        topic: 'message.new',
        payload: {
          id: 'm-intent-main',
          conversation_id: 'c-agent',
          sender: { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
          content_type: 'rich_card',
          content: {
            card_type: 'intent_authorization',
            authorization_id: 'auth-main-1',
            agent_name: 'Default',
            is_main_agent: true,
            status: 'pending',
            targets: [{ target_user_name: 'Bob', topic: 'hi' }],
          },
          timestamp: '2026-05-12T10:00:08Z',
          status: 'sent',
        },
      },
    },
  ];
  await server.pushTimeline(server.getActiveSockets(), MAIN_AGENT_AUTH);

  const card = window.getByTestId('intent-authorization-card');
  await expect(card).toBeVisible({ timeout: 5000 });
  // No Approve button.
  await expect(window.getByTestId('intent-approve-btn')).toHaveCount(0);
  // Single Understood / Deny button.
  const denyBtn = window.getByTestId('intent-deny-btn');
  await expect(denyBtn).toBeVisible();
  // Label should read "Understood" — the main-agent branch uses
  // `intentUnderstood` i18n key with English fallback "Understood".
  await expect(denyBtn).toHaveText(/Understood/i);
});
