// e2e/fixtures/agent-governance-flow.ts
//
// Shared helpers for the round-6 "Agent governance demo story" specs
// (30-37). Each spec still launches its own fake-server + Electron
// (per the spec-per-stage decision), but they reuse these:
//
//   - createGovernanceServer(): wraps startFakeServer with the extra
//     __test/* routes the flow specs need (last-agent-payload,
//     last-tag-patch, last-discovery-confirm, pushIntentAuth,
//     pushDiscoveryTask, etc.) so each spec doesn't redefine them.
//
//   - login() / loginAndOpenAgent(): standard auth + open-conversation
//     bootstrap. Both wait for the "Connected" pill so subsequent UI
//     interactions don't race the gateway handshake.
//
//   - pushIntentAuth() / pushDiscoveryTask() / pushDialogApproval():
//     thin wrappers that deliver a single PushFrame via the existing
//     pushTimeline helper, so specs read like a story.
//
//   - waitForReceivedFrame(): polls /__test/received-frames for a
//     specific envelope type. Used to assert client-emitted WS frames
//     (intent_authorize, message.stop, dialog.refine, etc.).
//
// The fixtures are NOT singletons — each spec instantiates a fresh
// server + app, so state never leaks between tests. Cross-stage state
// (e.g. "the agent created in Stage 1 is the one Discovery uses in
// Stage 3") is encoded in the fixture payloads, not in shared module
// state.

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { startFakeServer, type FakeServer, type FakeServerOptions } from './fake-server';
import { type LaunchResult } from './launch-app';

export interface GovernanceServerHandles {
  server: FakeServer;
  /** Most recent POST /api/v1/agents body (for create-agent assertions). */
  getLastAgentCreate: () => Promise<unknown | null>;
  /** Most recent PATCH /api/v1/tags/:id body (for tag-acl assertions). */
  getLastTagPatch: () => Promise<{ id: string; body: unknown } | null>;
  /** Most recent POST /api/v1/agent-discovery/:id/confirm body. */
  getLastDiscoveryConfirm: () => Promise<{ id: string; body: unknown } | null>;
  /** Most recent dialog.intent_authorize envelope (from received-frames). */
  waitForIntentAuth: (timeoutMs?: number) => Promise<{
    type: string;
    data: { authorization_id: string; approved: boolean };
  } | null>;
  /** Most recent dialogs.* HTTP body keyed by sessionId. */
  getLastDialogRefine: () => Promise<unknown | null>;
}

/**
 * Spin up a fake-server with the round-6 governance __test routes
 * installed. Wraps `startFakeServer`'s overrides so individual specs
 * stay readable.
 */
export async function createGovernanceServer(
  extraOverrides: FakeServerOptions['overrides'] = {},
): Promise<GovernanceServerHandles> {
  // The fake-server's `overrides` map runs before default handlers, so
  // each route below captures the last request body in module-private
  // state and forwards an echo response. Specs read the state via the
  // helper getters.
  const captured: {
    lastAgentCreate: unknown | null;
    lastTagPatch: { id: string; body: unknown } | null;
    lastDiscoveryConfirm: { id: string; body: unknown } | null;
    lastDialogRefine: unknown | null;
  } = {
    lastAgentCreate: null,
    lastTagPatch: null,
    lastDiscoveryConfirm: null,
    lastDialogRefine: null,
  };

  const server = await startFakeServer({
    overrides: {
      'POST /api/v1/agents': (req, res) => {
        captured.lastAgentCreate = req.body;
        // Echo back a 'data' wrapped agent so the renderer's create
        // mutation resolves and re-renders the agent list. Mirrors the
        // CONVERSATIONS_RESPONSE / TAGS_RESPONSE wire shape.
        res.json({
          data: {
            id: 'a-new',
            owner_id: 'u-e2e',
            ...((req.body ?? {}) as Record<string, unknown>),
            status: 'online',
            created_at: '2026-05-14T00:00:00Z',
            updated_at: '2026-05-14T00:00:00Z',
          },
        });
      },
      'PATCH /api/v1/tags/:id': (req, res) => {
        captured.lastTagPatch = { id: req.params.id as string, body: req.body };
        res.json({
          data: {
            id: req.params.id,
            display_name: (req.body as { displayName?: string })?.displayName ?? 'Tag',
            color: '#ABC',
            is_main: false,
            is_default: false,
            node_acl: (req.body as { nodeAcl?: unknown })?.nodeAcl ?? {
              allowed_paths: [],
              denied_paths: [],
            },
          },
        });
      },
      'POST /api/v1/discovery-tasks/:id/confirm': (req, res) => {
        captured.lastDiscoveryConfirm = { id: req.params.id as string, body: req.body };
        // Echo a valid DiscoveryTask back so DiscoveryResponseSchema.parse
        // succeeds in DiscoveryService.confirm (otherwise the mutation
        // throws and the spec's optimistic refetch never lands).
        res.json({
          data: {
            id: req.params.id,
            source_conversation_id: 'c-agent',
            initiator_agent_id: 'a-helper',
            initiator_owner_id: 'u-e2e',
            status: 'running',
            original_intent: '',
            max_hops: 3,
            current_hop_count: 1,
            max_concurrent: 2,
            pending_queries: [],
            completed_results: [],
            active_sessions: [],
            created_at: '2026-05-14T00:00:00Z',
            updated_at: '2026-05-14T00:00:00Z',
          },
        });
      },
      'POST /api/v1/agent-dialogs/:id/refine': (req, res) => {
        captured.lastDialogRefine = { id: req.params.id, body: req.body };
        res.json({ data: { ok: true } });
      },
      ...extraOverrides,
    },
  });

  return {
    server,
    getLastAgentCreate: async () => captured.lastAgentCreate,
    getLastTagPatch: async () => captured.lastTagPatch,
    getLastDiscoveryConfirm: async () => captured.lastDiscoveryConfirm,
    getLastDialogRefine: async () => captured.lastDialogRefine,
    waitForIntentAuth: async (timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const res = await fetch(`${server.url}/__test/received-frames`);
        const frames = (await res.json()) as Array<{
          type?: string;
          data?: { authorization_id?: string; approved?: boolean };
        }>;
        const found = frames.find((f) => f.type === 'dialog.intent_authorize');
        if (found?.type && found.data?.authorization_id && typeof found.data.approved === 'boolean') {
          return {
            type: found.type,
            data: { authorization_id: found.data.authorization_id, approved: found.data.approved },
          };
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    },
  };
}

/** Login + wait for Connected pill. Returns nothing — Page is the caller's. */
export async function login(window: Page, account = 'e2e@clawnet.test', password = 'any'): Promise<void> {
  await window.getByLabel(/Account/i).fill(account);
  await window.getByLabel(/Password/i).fill(password);
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });
}

/** Login then click the seeded Helper Agent conversation. */
export async function loginAndOpenAgent(app: LaunchResult): Promise<void> {
  const { window } = app;
  await login(window);
  await window.getByText('Helper Agent').first().click();
}

/** Push a single PushFrame via the existing pushTimeline helper. The
 *  governance specs always push exactly one frame, so this wrapper
 *  saves the per-spec timeline boilerplate. */
export async function pushFrame(
  server: FakeServer,
  topic: string,
  payload: unknown,
  delayMs = 100,
): Promise<void> {
  await server.pushTimeline(server.getActiveSockets(), [
    { delayMs, frame: { type: 'push', topic, payload } },
  ]);
}
