// e2e/05-stream-perf.spec.ts
// Performance baseline: a long stream (~4950 chars / ~110 delta frames over
// 5s) should render at least 80% of the content within the budget. The test
// polls the streaming-bubble's text length while frames arrive and records
// the peak length seen before the stream ends.
import { test, expect } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import { LONG_STREAM_TIMELINE } from './fixtures/long-stream-script';

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

test('long stream renders >=80% of content within budget', async () => {
  const { window } = app;

  // Login + open conversation
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });
  await window.getByText('Helper Agent').first().click();
  // Wait for the conversation to be active (history loaded).
  // Sidebar preview + bubble both render this text — `.first()` skips the
  // sidebar match (rendered before the messages list).
  await expect(window.getByText('Hi there!').first()).toBeVisible({ timeout: 5000 });

  // Kick off the timeline in the background — pushTimeline awaits 6+ seconds
  // due to the per-frame delays. We start it without awaiting so we can poll
  // the renderer while frames arrive.
  const start = Date.now();
  const pushP = server.pushTimeline(server.getActiveSockets(), LONG_STREAM_TIMELINE);

  // Wait for the streaming bubble to appear.
  const bubble = window.locator('[data-testid="streaming-bubble"]');
  await expect(bubble).toBeVisible({ timeout: 8000 });

  // Poll the rendered text length while the stream is still active. Stop
  // when the bubble disappears (= stream ended) or we hit the budget.
  let peakLength = 0;
  const budgetMs = 15_000;
  while (Date.now() - start < budgetMs) {
    const visible = await bubble.isVisible().catch(() => false);
    if (!visible) break;
    const text = (await bubble.textContent().catch(() => '')) ?? '';
    if (text.length > peakLength) peakLength = text.length;
    if (peakLength >= 4000) break;
    await window.waitForTimeout(100);
  }

  await pushP;
  const elapsed = Date.now() - start;

  expect(peakLength).toBeGreaterThanOrEqual(4000);
  expect(elapsed).toBeLessThan(20_000);
});
