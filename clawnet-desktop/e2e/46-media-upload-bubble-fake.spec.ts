// e2e/46-media-upload-bubble-fake.spec.ts
//
// Batch E (image bridge + upload bubble) — send-side flow.
//
// What this spec proves:
//   1. clicking Send with a file inserts the OPTIMISTIC bubble synchronously
//      (no IPC round-trip latency), and
//   2. once the upload pipeline completes, the bubble's <img src> swaps
//      from the optimistic `file://{localPath}` preview to the post-upload
//      `clawnet-file://{fileId}` form (proving the chat.message.replaced
//      IPC event landed in the renderer).
//
// We bypass the native file-picker (chat.pickFile would block on a real
// dialog) and call `chat.sendFile` straight through the preload bridge.
// That's the same pattern used by 06-file-upload and 07-media-bubbles, so
// the renderer→main→fake-server roundtrip is exercised end-to-end without
// a UI dependency on the OS file dialog.
import { test, expect } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let server: FakeServer;
let app: LaunchResult;
let tmp: string;
let imageFile: string;

test.beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'clawnet-e2e-46-'));
  imageFile = join(tmp, 'big-red.png');
  // Synthesize a ~600KB blob with a PNG signature so mime sniffing detects
  // it as image/png. The bytes themselves don't need to be a valid image —
  // the renderer just stores the localPath and lets <img> attempt to load
  // it; the post-upload swap to clawnet-file:// is what we actually assert.
  const PNG_HEADER = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const payload = Buffer.concat([PNG_HEADER, Buffer.alloc(600 * 1024, 0xaa)]);
  writeFileSync(imageFile, payload);
  server = await startFakeServer();
  app = await launchApp({ serverURL: server.url });
});

test.afterEach(async () => {
  await app.close();
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
});

test('upload bubble: optimistic image appears immediately, then swaps to clawnet-file:// after upload completes', async () => {
  const { window } = app;

  // Login + open conversation.
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });
  await window.getByText('Helper Agent').first().click();
  await expect(window.getByText('Hi there!').first()).toBeVisible();

  // Fire chat.sendFile via the preload bridge. We DON'T await the IPC's
  // outer Promise here — the optimistic insert is supposed to land before
  // the upload pipeline finishes, so awaiting would defeat the test.
  await window.evaluate((path: string) => {
    const w = window as unknown as {
      clawnet: {
        invoke: (
          ch: string,
          payload: unknown,
        ) => Promise<unknown>;
      };
    };
    // Intentionally fire-and-forget: we want the assertion below to see the
    // optimistic state, then a few hundred ms later the post-upload swap.
    void w.clawnet.invoke('chat.sendFile', {
      conversationId: 'c-agent',
      localPath: path,
    });
  }, imageFile);

  // Step 1: optimistic bubble (image variant) appears almost immediately.
  // Generous timeout because Electron's main process needs one event-loop
  // turn for the IPC → store insert → chat.message.created event roundtrip.
  await expect(window.getByTestId('image-bubble').last()).toBeVisible({
    timeout: 3_000,
  });

  // Step 2: eventually the bubble's image swaps from the optimistic
  // `file://{localPath}` preview to the post-upload `clawnet-file://{id}`
  // form. Use poll because the chunking + post happens off-thread; this is
  // the actual proof that chat.message.replaced reached the renderer and
  // its useMessages listener swapped the entry.
  //
  // The optimistic placeholder also carries the testid, so picking
  // `.last()` keeps us on the bubble that swapped in place. (The renderer
  // doesn't insert a NEW bubble — replaceOptimistic mutates the same row.)
  await expect
    .poll(
      async () => {
        const src = await window
          .getByTestId('image-bubble')
          .last()
          .locator('img')
          .getAttribute('src');
        return src?.startsWith('clawnet-file://') ?? false;
      },
      { timeout: 10_000, message: 'image bubble never swapped to clawnet-file://' },
    )
    .toBe(true);
});
