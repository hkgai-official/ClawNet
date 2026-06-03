// e2e/24-round5-stop-cancel.spec.ts
//
// Round-5 M #B2: the in-window StatusBar exposes a Stop button while a
// stream is in flight. Clicking it MUST send a `message.stop` envelope
// keyed by `conversation_id` (NOT `message_id`) per macOS
// ChatService.abortCurrentRun (ChatService.swift:983-989).
//
// Regression: an earlier draft of the IPC used `message_id` and the
// server silently ignored it. This spec asserts the wire shape so the
// bug can't drift back.

import { test, expect } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';

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

// Partial stream: stream_start + a few deltas, NO stream_end so the
// Stop button stays visible while we click it.
const PARTIAL_STREAM: Array<{ delayMs: number; frame: unknown }> = [
  {
    delayMs: 100,
    frame: {
      type: 'push',
      topic: 'message.stream_start',
      payload: {
        message_id: 'r-stop-1',
        conversation_id: 'c-agent',
        sender: { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
      },
    },
  },
  {
    delayMs: 50,
    frame: {
      type: 'push',
      topic: 'message.stream_delta',
      payload: { message_id: 'r-stop-1', delta: 'Lorem ' },
    },
  },
  {
    delayMs: 50,
    frame: {
      type: 'push',
      topic: 'message.stream_delta',
      payload: { message_id: 'r-stop-1', delta: 'ipsum…' },
    },
  },
];

test('M #B2: Stop button sends message.stop with conversation_id', async () => {
  const { window } = app;

  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  // Open the Helper Agent conversation (seeded by fake-server responses).
  await window.getByText('Helper Agent').first().click();

  // Trigger a send to ensure the conversation is active in main process,
  // then push a partial stream that leaves Stop visible.
  const composer = window.getByPlaceholder(/Type a message/i);
  await composer.fill('long pls');
  await composer.press('Enter');

  await server.pushTimeline(server.getActiveSockets(), PARTIAL_STREAM);

  // StatusBar's Stop button — aria-label is the i18n key "stop" via the
  // mock t() in unit tests, but in the real app it resolves to the
  // English label. `button` role + accessible name covers both.
  const stopBtn = window.getByRole('button', { name: /stop/i });
  await expect(stopBtn).toBeVisible({ timeout: 5000 });
  await stopBtn.click();

  // Poll /__test/received-frames until the message.stop envelope arrives
  // (or 5s elapse).
  let stopFrame: { type: string; data?: { conversation_id?: string; message_id?: string } } | null =
    null;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const res = await fetch(`${server.url}/__test/received-frames`);
    const frames = (await res.json()) as Array<{
      type?: string;
      data?: { conversation_id?: string; message_id?: string };
    }>;
    const found = frames.find((f) => f.type === 'message.stop');
    if (found?.type) {
      stopFrame = { type: found.type, ...(found.data ? { data: found.data } : {}) };
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  expect(stopFrame, 'message.stop envelope was not received').toBeTruthy();
  expect(stopFrame!.data).toEqual({ conversation_id: 'c-agent' });
  // Regression guard: there must NOT be a message_id field — macOS uses
  // conversation-scoped cancellation.
  expect(stopFrame!.data?.message_id).toBeUndefined();
});
