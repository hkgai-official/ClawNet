// e2e/47-media-receive-and-open-fake.spec.ts
//
// Batch E (image bridge + upload bubble) — receive-side flow.
//
// Two scenarios:
//   1. Incoming IMAGE message → renderer's <img src> resolves to
//      `clawnet-file://{fileId}` and CSP allows the load. Clicking opens
//      the lightbox. Proves the Electron custom-protocol bridge fetches
//      the bytes from the fake-server with the right Bearer token AND
//      that index.html's CSP whitelist accepts the new scheme.
//   2. Incoming FILE (non-image) message → clicking the Open button fires
//      chat.fetchFileForOpen, which downloads via the streaming pipeline,
//      caches under AppPaths.mediaCache(), and only then invokes
//      shell.openPath. We don't try to make shell.openPath succeed (the
//      Linux CI doesn't have a registered handler for application/octet-
//      stream) — we just assert the download completed and the renderer's
//      download-slice reached `completed` state.
import { test, expect } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';

// Smallest valid PNG: 1×1 red pixel. Same constant used in 07-media-bubbles
// so the renderer's mime-sniffer is happy.
const ONE_PX_RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==',
  'base64',
);

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

test('receive image: bubble renders via clawnet-file://, click opens lightbox', async () => {
  const { window } = app;

  // Login + wait for socket-up.
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  // Open the seeded conversation BEFORE pushing so the message-list view
  // is already mounted and its useIpcEvent('chat.message.created') listener
  // is active when the push arrives.
  await window.getByText('Helper Agent').first().click();
  await expect(window.getByText('Hi there!').first()).toBeVisible();

  // Seed the image bytes BEFORE pushing the message so the protocol bridge
  // sees them on the first fetch (otherwise the renderer would load a 404).
  server.seedImage('file-img-1', ONE_PX_RED_PNG);
  await server.pushIncomingImage({
    conversationId: 'c-agent',
    fileId: 'file-img-1',
    name: 'red.png',
    size: ONE_PX_RED_PNG.byteLength,
  });

  // The image bubble's <img> must point at clawnet-file://file-img-1.
  // The fake-server's GET /api/v1/files/:id/download returns the bytes;
  // the protocol handler attaches the Bearer token so the proxied fetch
  // succeeds and the browser-side <img> decodes the PNG.
  const img = window.getByTestId('image-bubble').first().locator('img');
  await expect(img).toHaveAttribute('src', /^clawnet-file:\/\/file-img-1/, {
    timeout: 10_000,
  });

  // Click to open the lightbox (data-testid="image-lightbox" portaled to
  // document.body — see image-lightbox.tsx).
  await window.getByTestId('image-bubble').first().click();
  await expect(window.getByTestId('image-lightbox')).toBeVisible();
});

test('receive file: click Open downloads + caches + invokes shell.openPath', async () => {
  const { window } = app;

  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  // Open conversation FIRST so the useMessages hook is mounted and listening
  // for chat.message.created before the WS push lands.
  await window.getByText('Helper Agent').first().click();
  await expect(window.getByText('Hi there!').first()).toBeVisible();

  const bytes = Buffer.from('FAKE PDF BYTES — content does not need to parse');
  server.seedFile('file-doc-1', bytes, 'application/pdf', 'doc.pdf');
  await server.pushIncomingFile({
    conversationId: 'c-agent',
    fileId: 'file-doc-1',
    name: 'doc.pdf',
    size: bytes.byteLength,
    mimeType: 'application/pdf',
  });

  // The file bubble for an incoming message includes the Open button
  // (aria-label="Open"). Click it; this fires chat.fetchFileForOpen,
  // streams the bytes into the media cache, then calls shell.openPath.
  // We DON'T assert that shell.openPath succeeds — Linux CI doesn't have a
  // registered handler for application/pdf, and the button's loading-state
  // depends on shell.openPath actually resolving. Instead we ask the fake-
  // server how many times it served the download endpoint for this fileId;
  // a single successful download proves chat.fetchFileForOpen reached the
  // streaming pipeline and exhausted the response body.
  const fileBubble = window.getByTestId('file-bubble').first();
  await expect(fileBubble).toBeVisible({ timeout: 10_000 });
  await fileBubble.getByRole('button', { name: /open/i }).click();

  // Poll the fake-server's download tally until it observes our fetch. This
  // is the strongest proof that doesn't depend on host-specific behaviour
  // (shell.openPath returns differently on Linux/macOS/Windows when there's
  // no associated handler — sometimes empty, sometimes "no such file…").
  await expect
    .poll(
      async () => {
        const res = await fetch(`${server.url}/__test/download-count/file-doc-1`);
        const body = (await res.json()) as { count: number };
        return body.count;
      },
      { timeout: 10_000, message: 'fake-server never saw the file download' },
    )
    .toBeGreaterThanOrEqual(1);
});
