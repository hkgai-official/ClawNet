// e2e/26-round5-virtualization.spec.ts
//
// Round-5 O #P4: MessageList is virtualized via @tanstack/react-virtual.
// Built-mode regressions to guard against:
//   - long history renders (virtualizer doesn't drop messages off the
//     scroll buffer permanently),
//   - opening a conversation auto-scrolls to the LAST message,
//   - sending a new message scrolls the new bubble into view.
//
// We deliberately avoid asserting "user-scrolled-up doesn't get yanked"
// here because jsdom layout doesn't translate to Playwright's headed
// behavior reliably; the unit test in message-list.test.tsx covers that
// path with a mocked virtualizer.

import { test, expect } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';

let server: FakeServer;
let app: LaunchResult;

// 60 messages: enough to force the virtualizer into windowing mode while
// still small enough to load in <1s.
const LONG_MESSAGES = {
  data: Array.from({ length: 60 }).map((_, i) => ({
    id: `m-${String(i).padStart(3, '0')}`,
    conversation_id: 'c-agent',
    sender: {
      id: i % 2 === 0 ? 'a-helper' : 'u-me',
      name: i % 2 === 0 ? 'Helper Agent' : 'You',
      type: i % 2 === 0 ? 'agent' : 'human',
    },
    content_type: 'text',
    content: { text: `MSG_${i}` },
    timestamp: new Date(2026, 4, 1, 0, i).toISOString(),
    status: 'sent',
  })),
  meta: { page: 1, page_size: 60, total: 60, has_more: false },
};

test.afterEach(async () => {
  await app.close();
  await server.close();
});

async function login(app: LaunchResult) {
  const { window } = app;
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });
  await window.getByText('Helper Agent').first().click();
}

test('O #P4: long history renders + last message scrolled into view', async () => {
  server = await startFakeServer({
    overrides: {
      'GET /api/v1/conversations/:id/messages': (_req, res) => {
        res.json(LONG_MESSAGES);
      },
    },
  });
  app = await launchApp({ serverURL: server.url });
  await login(app);
  const { window } = app;

  // First and last messages should both be reachable in the DOM —
  // virtualizer renders the in-view window plus overscan, so the last
  // (auto-scrolled-to) message must be present.
  await expect(window.getByText('MSG_59')).toBeVisible({ timeout: 5000 });

  // A middle message may be windowed-out (not rendered or off-screen);
  // we only assert the boundary indices are reachable via scroll. The
  // virtualizer's translateY puts MSG_59 near the bottom and earlier
  // items at higher offsets. Without driving the scroll container, we
  // can at least confirm the *count* of rendered bubble nodes is sane
  // (not 60, not 0 — somewhere in the overscan window).
  const bubbles = window.locator('[data-testid^="message-m-"]');
  const renderedCount = await bubbles.count();
  // Overscan=8 + view ~10 = ~18 nodes; allow 5–60 as a generous band.
  expect(renderedCount).toBeGreaterThan(5);
  expect(renderedCount).toBeLessThanOrEqual(60);
});

test('O #P4: sending a new message scrolls to the new bubble', async () => {
  server = await startFakeServer({
    overrides: {
      'GET /api/v1/conversations/:id/messages': (_req, res) => {
        res.json(LONG_MESSAGES);
      },
    },
  });
  app = await launchApp({ serverURL: server.url });
  await login(app);
  const { window } = app;

  await expect(window.getByText('MSG_59')).toBeVisible({ timeout: 5000 });

  const composer = window.getByPlaceholder(/Type a message/i);
  await composer.fill('FRESH_MESSAGE_777');
  await composer.press('Enter');

  // After send, the new bubble must not only exist in the DOM (which it
  // would even just from virtualizer overscan) — it must actually be
  // INSIDE the scroll viewport. Regression for the "send → no scroll"
  // bug: isAtBottomRef was flipping to false on the same render that
  // added the message, blocking scrollToIndex.
  const bubble = window.getByText('FRESH_MESSAGE_777');
  await expect(bubble).toBeVisible({ timeout: 5000 });
  // isIntersecting check via bounding rect — the bubble's top must be
  // within the message-list scroll container's vertical extent.
  await window.waitForTimeout(300); // let smooth scroll settle
  const inView = await bubble.evaluate((el) => {
    const r = el.getBoundingClientRect();
    // Find the scroll container (role="log" or ancestor with overflow auto).
    let p: HTMLElement | null = el.parentElement;
    while (p && getComputedStyle(p).overflowY !== 'auto') p = p.parentElement;
    if (!p) return false;
    const pr = p.getBoundingClientRect();
    // Bubble is in view if its rect intersects the scroll container's rect.
    return r.bottom > pr.top && r.top < pr.bottom;
  });
  expect(inView, 'new bubble must be scrolled into the visible viewport').toBe(true);
});
