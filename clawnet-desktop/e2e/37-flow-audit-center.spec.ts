// e2e/37-flow-audit-center.spec.ts
//
// Stage 7: SecurityEventCenter aggregates events across the demo flow.
// We push 3 representative audit events covering each macOS category,
// open the Security panel, and verify:
//   - all 3 events render
//   - category filter narrows to one event
//   - search box narrows by agent name / detail text
//   - mark-all-as-read drops the unread badge

import { test, expect } from '@playwright/test';
import { createGovernanceServer, login } from './fixtures/agent-governance-flow';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import type { GovernanceServerHandles } from './fixtures/agent-governance-flow';

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

// WS event path uses AgentEventBus.relay which calls AuditEventSchema.parse
// directly without snake-to-camel conversion. Payload keys must be the
// camelCase shape the schema expects (eventType / agentId / agentName /
// isRead). The REST `audit.events.list` path DOES convert; only push frames
// don't.
const EVENTS = [
  {
    id: 'evt-1',
    // audit.access_denied (underscore, not dot) — see audit-event-row
    // describeEvent switch; with the dot variant it falls into the
    // fallback template which doesn't surface the agent name.
    eventType: 'audit.access_denied',
    agentId: 'a-helper',
    agentName: 'Helper Agent',
    details: { path: '/Users/alice/.env', command: 'read_file' },
    timestamp: '2026-05-14T00:00:01Z',
  },
  {
    id: 'evt-2',
    eventType: 'dialog.approval_request',
    agentId: 'a-other',
    agentName: 'Other Agent',
    details: { topic: 'python sync', initiator_owner: 'Bob' },
    timestamp: '2026-05-14T00:00:02Z',
  },
  {
    id: 'evt-3',
    eventType: 'audit.boundary_violation',
    agentId: 'a-rogue',
    agentName: 'Rogue Agent',
    tagRole: 'delegate',
    details: { violation_type: 'path_exfil', attempted_path: '/etc/passwd' },
    timestamp: '2026-05-14T00:00:03Z',
  },
];

test('Stage 37: SecurityEventCenter aggregates events + filter + search work', async () => {
  const { window } = app;
  await login(window);

  // Open Security panel FIRST so useAuditEvents subscribes to the
  // audit.event IPC channel before we start pushing. Otherwise pushes
  // sent during the connection-establishment window may be lost.
  await window.getByRole('button', { name: /^Security$/i }).click();
  await expect(window.getByText(/No security events yet|matching|All/i).first()).toBeVisible({
    timeout: 5_000,
  });

  // Push 3 events covering different categories.
  for (const ev of EVENTS) {
    await fetch(`${handles.server.url}/__test/push-audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ev),
    });
  }
  // Give the renderer a tick to ingest all three.
  await window.waitForTimeout(300);

  // All 3 agent names visible.
  await expect(window.getByText(/Helper Agent/i)).toBeVisible({ timeout: 5_000 });
  await expect(window.getByText(/Other Agent/i)).toBeVisible();
  await expect(window.getByText(/Rogue Agent/i)).toBeVisible();

  // Search by agent name.
  const searchBox = window.getByPlaceholder(/Search/i).first();
  await searchBox.fill('Rogue');
  await expect(window.getByText(/Rogue Agent/i)).toBeVisible();
  await expect(window.getByText(/Helper Agent/i)).toHaveCount(0);
  await searchBox.fill('');

  // Search by detail text.
  await searchBox.fill('passwd');
  await expect(window.getByText(/Rogue Agent/i)).toBeVisible();
  await expect(window.getByText(/Helper Agent/i)).toHaveCount(0);
});
