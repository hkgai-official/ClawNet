// e2e/38-flow-notification.spec.ts
//
// Stage 8: desktop notifications fire (or rather, "would fire") on
// incoming messages from other senders.
//
// The OS-level Notification is suppressed in headless mode so the host
// user isn't disturbed during test runs (NotificationService.ts:
// isHeadlessLike() guard). To still verify the wiring, NotificationService
// keeps an `emittedLog` of every call regardless of headless mode, and
// main/index.ts exposes it via a `__test.notifications.log` IPC channel.
//
// We push two messages:
//   1. From another user → should be logged.
//   2. From the current user (echo back from server) → should NOT be
//      logged (the maybeNotify guard skips own messages).
// And the spec asserts only the first appears in the log.

import { test, expect } from '@playwright/test';
import { createGovernanceServer, login } from './fixtures/agent-governance-flow';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import type { GovernanceServerHandles } from './fixtures/agent-governance-flow';
import type { Page } from '@playwright/test';

let handles: GovernanceServerHandles;
let app: LaunchResult;

test.beforeEach(async () => {
  handles = await createGovernanceServer();
  app = await launchApp({ serverURL: handles.server.url });
});

test.afterEach(async () => {
  await app.close();
  await handles.server.close();
});

async function getNotificationLog(window: Page): Promise<
  Array<{ senderName: string; body: string; conversationId: string }>
> {
  return window.evaluate(async () => {
    const api = (window as unknown as {
      clawnet?: { invoke: (name: string, input: unknown) => Promise<unknown> };
    }).clawnet;
    // The `__test.notifications.log` channel is registered via raw
    // `ipcMain.handle` (not the typed router), so the response shape is
    // just the array — NOT the `Result<T>` wrapper that the router
    // returns. Cast accordingly.
    const res = (await api?.invoke('__test.notifications.log', null)) as
      | Array<{ senderName: string; body: string; conversationId: string }>
      | undefined;
    return res ?? [];
  });
}

test('Stage 38: incoming msg from another user → notification logged; own msg → suppressed', async () => {
  const { window } = app;
  await login(window);

  // Force the renderer window into an unfocused state so the
  // isAppFocused() guard in maybeNotify lets the notify path run.
  // Playwright's CDP attachment doesn't change OS focus, and Electron
  // launched via _electron may grab focus even when positioned
  // offscreen. Calling BrowserWindow.blur() from main-process via the
  // Electron-test API takes the focus away.
  await app.app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.blur();
  });
  await handles.server.pushTimeline(handles.server.getActiveSockets(), [
    {
      delayMs: 100,
      frame: {
        type: 'push',
        topic: 'message.new',
        payload: {
          id: 'm-other-1',
          conversation_id: 'c-agent',
          sender: { id: 'u-other', name: 'Alice', type: 'human' },
          content_type: 'text',
          content: { text: 'incoming ping' },
          timestamp: '2026-05-14T00:00:20Z',
          status: 'sent',
        },
      },
    },
  ]);

  // Own-message: should always be suppressed regardless of focus state.
  await handles.server.pushTimeline(handles.server.getActiveSockets(), [
    {
      delayMs: 100,
      frame: {
        type: 'push',
        topic: 'message.new',
        payload: {
          id: 'm-own-1',
          conversation_id: 'c-agent',
          sender: { id: 'u-e2e', name: 'E2E User', type: 'human' },
          content_type: 'text',
          content: { text: 'self echo' },
          timestamp: '2026-05-14T00:00:21Z',
          status: 'sent',
        },
      },
    },
  ]);

  // Poll the log (allow for the WS roundtrip).
  let log: Array<{ senderName: string; body: string; conversationId: string }> = [];
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    log = await getNotificationLog(window);
    if (log.some((e) => e.senderName === 'Alice')) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  // Alice's message is logged. The text might land before the message
  // even reaches the chat panel (focus check) — both outcomes are
  // acceptable as long as our OWN message is NOT logged.
  const aliceEntries = log.filter((e) => e.senderName === 'Alice');
  const ownEntries = log.filter((e) => e.senderName === 'E2E User');

  // Own message must never appear (suppressed by getCurrentUserId guard).
  expect(ownEntries.length).toBe(0);
  // Alice's message must have been considered (logged regardless of OS-level
  // suppression). In some envs the app is "focused" so the focus guard
  // kicks in first and skips the log — accept that too, but at minimum we
  // must have a path where it was processed: either logged, OR focus check
  // returned true. We can't observe the latter directly; use a soft assert
  // that we got at least one log entry total (either Alice or none, but
  // never own).
  expect(aliceEntries.length).toBeGreaterThan(0);
});
