// e2e/43-a2a-reply-paths-fake.spec.ts
//
// Fake-server coverage of the FOUR A2A reply paths from the
// `A2AReviewPanel`. Complements prod spec 45 (which proves the live
// LLM end-to-end works for tag-draft + manual) by exercising the
// client wiring deterministically for all four paths in seconds.
//
// Approach: stub the dialog session via the fake server, then push
// `dialog.pending_review` (server → renderer) to populate the tag
// draft. Each test exercises one path and asserts the right POST
// endpoint is hit with the expected body.

import { test, expect } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';

const SESSION_ID = 'sess-fake-a2a-1';
const DIALOG_CONV_ID = 'c-fake-dialog';
const ME_ID = 'u-e2e';

let server: FakeServer;
let app: LaunchResult;
let postedBodies: Array<{ path: string; body: unknown }> = [];

test.beforeEach(async () => {
  postedBodies = [];
  server = await startFakeServer({
    overrides: {
      // Conversation list — add a dialog conversation alongside the
      // default one so the renderer can navigate into it and mount
      // A2AReviewPanel.
      'GET /api/v1/conversations': (_req, res) => {
        res.json({
          data: [
            {
              id: DIALOG_CONV_ID,
              type: 'direct',
              participants: [
                { id: ME_ID, name: 'E2E User', type: 'human' },
                { id: 'a-bob', name: 'Bob Agent', type: 'agent' },
              ],
              last_message_preview: '',
              last_message_at: '2026-05-15T00:00:00Z',
              unread_count: 0,
              created_at: '2026-05-15T00:00:00Z',
              updated_at: '2026-05-15T00:00:00Z',
            },
          ],
        });
      },
      // Return an empty message list for this conversation.
      'GET /api/v1/conversations/:id/messages': (_req, res) => {
        res.json({ data: [], meta: { page: 1, page_size: 50, total: 0, has_more: false } });
      },
      // Return an ACTIVE dialog session when the renderer asks for the
      // conv's session. This is what makes A2AReviewPanel mount.
      'GET /api/v1/agent-dialogs/by-conversation/:id': (req, res) => {
        if (req.params.id !== DIALOG_CONV_ID) {
          res.status(404).json({ error: 'not_found' });
          return;
        }
        res.json({
          data: {
            id: SESSION_ID,
            initiator_agent: { id: 'a-alice', display_name: 'Default' },
            responder_agent: { id: 'a-bob', display_name: 'Bob Agent' },
            initiator_owner: { id: ME_ID, display_name: 'E2E User' },
            responder_owner: { id: 'u-bob', display_name: 'Bob' },
            topic: 'fake dialog',
            status: 'active',
            current_round: 0,
            max_rounds: 5,
            conversation_id: DIALOG_CONV_ID,
            created_at: '2026-05-15T00:00:00Z',
          },
        });
      },
      // Capture the four dialog action endpoints.
      'POST /api/v1/agent-dialogs/:id/approve': (req, res) => {
        postedBodies.push({ path: `/approve`, body: req.body });
        res.status(204).end();
      },
      'POST /api/v1/agent-dialogs/:id/request-main': (req, res) => {
        postedBodies.push({ path: `/request-main`, body: req.body });
        res.status(204).end();
      },
      'POST /api/v1/agent-dialogs/:id/refine': (req, res) => {
        postedBodies.push({ path: `/refine`, body: req.body });
        res.status(204).end();
      },
      'POST /api/v1/agent-dialogs/:id/submit-response': (req, res) => {
        postedBodies.push({ path: `/submit-response`, body: req.body });
        res.status(204).end();
      },
    },
  });
  app = await launchApp({ serverURL: server.url });
});

test.afterEach(async () => {
  await app.close();
  await server.close();
});

/** Helper: log in, open the dialog conv, wait for A2AReviewPanel,
 *  push the initial tag draft via dialog.pending_review.
 */
async function setupA2APanel(tagDraft: string): Promise<void> {
  await app.window.getByLabel(/Account/i).fill('alice');
  await app.window.getByLabel(/Password/i).fill('any');
  await app.window.getByRole('button', { name: /Sign in/i }).click();
  await expect(app.window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  // Click the dialog conversation. (Display name = the other
  // participant = "Bob Agent".)
  await app.window.getByText(/Bob Agent/).first().click();

  // Wait for the review panel to mount (it depends on the GET
  // /by-conversation/:id call returning an active session).
  await expect(app.window.getByTestId('a2a-review-panel')).toBeVisible({ timeout: 5_000 });

  // Push dialog.pending_review with the tag draft text. The main-
  // process AgentEventBus subscriber rewrites this as a
  // dialog.draft.updated IPC event for the renderer, which populates
  // `secondaryDraftText` for the tag SourceCard.
  await fetch(`${server.url}/__test/push-frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      frame: {
        type: 'dialog.pending_review',
        data: {
          session_id: SESSION_ID,
          conversation_id: DIALOG_CONV_ID,
          round: 0,
          draft_text: tagDraft,
          agent_name: 'Bob Agent',
        },
      },
    }),
  }).catch(() => undefined);

  await expect(async () => {
    const txt = await app.window.getByTestId('a2a-draft-tag').innerText();
    expect(txt).toContain(tagDraft.slice(0, 10));
  }).toPass({ timeout: 5_000 });
}

test('tag-draft path: Send via X submits tag draft', async () => {
  const TAG = 'Hello! This is the Bob agent draft response.';
  await setupA2APanel(TAG);

  await app.window.getByRole('button', { name: /Send via/i }).click();

  await expect(async () => {
    const submit = postedBodies.find((p) => p.path === '/submit-response');
    expect(submit, '/submit-response should fire').toBeTruthy();
    expect((submit!.body as { text: string }).text).toBe(TAG);
  }).toPass({ timeout: 3_000 });
});

test('manual path: typing + Send submits manual text', async () => {
  await setupA2APanel('initial tag draft');

  await app.window.getByText('You', { exact: true }).first().click();
  const manualBox = app.window.getByTestId('a2a-draft-manual');
  await manualBox.locator('textarea').fill('I will write this myself.');
  await app.window.getByRole('button', { name: /Send manual reply/i }).click();

  await expect(async () => {
    const submit = postedBodies.find((p) => p.path === '/submit-response');
    expect(submit, '/submit-response should fire').toBeTruthy();
    expect((submit!.body as { text: string }).text).toBe('I will write this myself.');
  }).toPass({ timeout: 3_000 });
});

test('main-draft path: Request Main → server pushes main draft → Send submits main text', async () => {
  await setupA2APanel('initial tag draft');

  // The Main Assistant source is a tab in the segmented switcher;
  // selecting it lazily fires the request-main IPC.
  await app.window.getByRole('tab', { name: /Main Assistant/i }).click();

  // Verify /request-main was called.
  await expect(async () => {
    expect(postedBodies.find((p) => p.path === '/request-main')).toBeTruthy();
  }).toPass({ timeout: 3_000 });

  // Server pushes main_draft_ready.
  const MAIN = 'Main assistant draft text.';
  await fetch(`${server.url}/__test/push-frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      frame: {
        type: 'dialog.main_draft_ready',
        data: { session_id: SESSION_ID, draft_text: MAIN },
      },
    }),
  });

  await expect(async () => {
    const txt = await app.window.getByTestId('a2a-draft-main').innerText();
    expect(txt).toContain(MAIN.slice(0, 10));
  }).toPass({ timeout: 5_000 });

  await app.window.getByTestId('a2a-draft-main').click();
  await app.window.getByRole('button', { name: /Send main draft/i }).click();

  await expect(async () => {
    const submits = postedBodies.filter((p) => p.path === '/submit-response');
    expect(submits.length).toBeGreaterThan(0);
    expect((submits.at(-1)!.body as { text: string }).text).toBe(MAIN);
  }).toPass({ timeout: 3_000 });
});

test('refine path: instruction → /refine fires → updated draft → Send submits refined', async () => {
  await setupA2APanel('Original draft.');

  const tagBox = app.window.getByTestId('a2a-draft-tag');
  const refineInput = tagBox.locator('xpath=..').getByPlaceholder(/Refine instruction/i).first();
  await refineInput.fill('make it friendlier');
  await tagBox.locator('xpath=..').getByRole('button', { name: /^Refine$/i }).first().click();

  // Verify /refine endpoint was called with target='tag'.
  await expect(async () => {
    const refine = postedBodies.find((p) => p.path === '/refine');
    expect(refine, '/refine should fire').toBeTruthy();
    expect((refine!.body as { target: string }).target).toBe('tag');
    expect((refine!.body as { instruction: string }).instruction).toBe('make it friendlier');
  }).toPass({ timeout: 3_000 });

  // Server pushes updated draft via dialog.draft_updated.
  const REFINED = 'Friendlier refined draft! 🎉';
  await fetch(`${server.url}/__test/push-frame`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      frame: {
        type: 'dialog.draft_updated',
        data: {
          session_id: SESSION_ID,
          target: 'tag',
          draft_text: REFINED,
        },
      },
    }),
  });

  await expect(async () => {
    const txt = await tagBox.innerText();
    expect(txt).toContain(REFINED.slice(0, 10));
  }).toPass({ timeout: 5_000 });

  await app.window.getByRole('button', { name: /Send via/i }).click();

  await expect(async () => {
    const submits = postedBodies.filter((p) => p.path === '/submit-response');
    expect(submits.length).toBeGreaterThan(0);
    expect((submits.at(-1)!.body as { text: string }).text).toBe(REFINED);
  }).toPass({ timeout: 3_000 });
});
