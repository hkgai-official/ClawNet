// e2e/03-token-refresh.spec.ts
// Validates HttpClient's 401-on-non-auth-route → refresh → retry path. The
// fake server returns 401 on the first /conversations GET, then 200 on
// subsequent calls; AuthManager.refreshAccessToken is wired as the
// onUnauthorized hook so ChatService.listConversations should still resolve
// from the renderer's perspective.
import { test, expect } from '@playwright/test';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import { CONVERSATIONS_RESPONSE } from './fixtures/responses';

let server: FakeServer;
let app: LaunchResult;

test.afterEach(async () => {
  await app.close();
  await server.close();
});

test('access-token expired triggers refresh + retry', async () => {
  let convCalls = 0;
  let refreshCalls = 0;
  server = await startFakeServer({
    overrides: {
      'GET /api/v1/conversations': (_req: ExpressRequest, res: ExpressResponse) => {
        convCalls += 1;
        if (convCalls === 1) {
          res.status(401).json({ error: 'token_expired' });
          return;
        }
        res.json(CONVERSATIONS_RESPONSE);
      },
      'POST /api/v1/auth/refresh': (_req: ExpressRequest, res: ExpressResponse) => {
        refreshCalls += 1;
        // Re-use the long-lived JWT from LOGIN_RESPONSE for simplicity.
        res.json({
          data: {
            access_token:
              'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjk5OTk5OTk5OTksInN1YiI6InUtZTJlIn0.sig',
            refresh_token: 'rt-rotated',
          },
        });
      },
    },
  });
  app = await launchApp({ serverURL: server.url });
  const { window } = app;

  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();

  // Eventually the conversation list resolves (after the 401-once + refresh
  // + retry). "Helper Agent" appears in the direct-conversation title.
  await expect(window.getByText('Helper Agent').first()).toBeVisible({ timeout: 15_000 });

  expect(convCalls).toBeGreaterThanOrEqual(2);
  expect(refreshCalls).toBeGreaterThanOrEqual(1);
});
