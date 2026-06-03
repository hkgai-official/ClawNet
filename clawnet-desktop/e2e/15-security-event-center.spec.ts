// e2e/15-security-event-center.spec.ts
//
// P3C SecurityEventCenter: nav into the shield panel, see the empty state,
// then drive a live `audit.event` WS push through the fake server and assert
// the row appears + filter chips work.
//
// The fake-server exposes:
//   GET  /api/v1/audit/events   → REST list (empty initially)
//   POST /__test/push-audit     → test-only helper that broadcasts a
//                                 `{ type: 'push', topic: 'audit.event' }`
//                                 frame to every connected WS client. The
//                                 main-process GatewayChannel → AgentEventBus
//                                 then validates with AuditEventSchema and
//                                 forwards to the renderer's `audit.event`
//                                 IPC channel, which feeds the audit slice.
//
// The push payload uses CAMELCASE keys because AgentEventBus.relay validates
// with AuditEventSchema directly (no snake→camel conversion on the WS path,
// unlike the REST list which goes through HttpClient).

import { test, expect, request as pwRequest } from '@playwright/test';
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

test('security: empty state, WS push appears, category filter works', async () => {
  const { window } = app;

  // --- Sign in (mirror spec 14's pattern; any creds are accepted) ---
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('tempPass1');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  // --- Open Security panel from the nav sidebar ---
  // NavSidebar's shield NavButton uses aria-label = tAudit('navLabel') which
  // resolves to "Security" (en). The plain "/^Security$/" anchor is enough —
  // no other element in the layout has that exact accessible name.
  await window.getByRole('button', { name: /^Security$/ }).click();

  // Empty state copy comes from audit.emptyTitle ("No security events yet").
  await expect(
    window.getByText(/No security events yet/i),
  ).toBeVisible({ timeout: 5_000 });

  // --- Push a live audit.event via the test helper ---
  // AuditEventSchema accepts: id, eventType, agentId?, agentName?, tagRole?,
  // details (Record<string,string>, defaulted), timestamp, isRead defaulted.
  // The audit-event-row's describeEvent() uses event.agentName for the
  // "access_denied" template, so "Helper" appears in the rendered row.
  const ctx = await pwRequest.newContext();
  await ctx.post(`${server.url}/__test/push-audit`, {
    data: {
      id: 'ev-1',
      eventType: 'audit.access_denied',
      agentId: 'a1',
      agentName: 'Helper',
      details: {
        path: 'C:\\secret\\token.txt',
        command: 'read_file',
      },
      timestamp: new Date().toISOString(),
    },
  });

  // The row should land in the list. Match on the agent name which is
  // interpolated into the access_denied template.
  await expect(window.getByText(/Helper/)).toBeVisible({ timeout: 5_000 });

  // --- Filter to "Boundary Violation" — list becomes empty (no match) ---
  await window
    .getByRole('button', { name: /^Boundary Violation$/ })
    .click();
  await expect(window.getByText(/No matching events/i)).toBeVisible({
    timeout: 5_000,
  });
  // And the event we pushed is filtered out of the list.
  await expect(window.getByText(/Helper/)).toHaveCount(0);

  // --- Filter back to "All" — event reappears ---
  // The "All" chip label is the only ^All$ button on the panel; the other
  // category chips have longer labels so there's no collision.
  await window.getByRole('button', { name: /^All$/ }).click();
  await expect(window.getByText(/Helper/)).toBeVisible({ timeout: 5_000 });

  await ctx.dispose();
});
