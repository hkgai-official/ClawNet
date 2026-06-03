// e2e/06-file-upload.spec.ts
// File-upload roundtrip: login → conversation → invoke chat.sendFile via
// the preload bridge (skipping the native file picker) → file bubble
// appears in the message list.
import { test, expect } from '@playwright/test';
import { startFakeServer, type FakeServer } from './fixtures/fake-server';
import { launchApp, type LaunchResult } from './fixtures/launch-app';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let server: FakeServer;
let app: LaunchResult;
let tmp: string;
let localFile: string;

test.beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'clawnet-e2e-upload-'));
  localFile = join(tmp, 'hello.txt');
  writeFileSync(localFile, 'hello from e2e', 'utf-8');
  server = await startFakeServer();
  app = await launchApp({ serverURL: server.url });
});

test.afterEach(async () => {
  await app.close();
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
});

test('chat.sendFile uploads a local file and renders a file bubble', async () => {
  const { window } = app;

  // Login
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });

  // Pick the seeded conversation
  await window.getByText('Helper Agent').first().click();
  await expect(window.getByText('Hi there!').first()).toBeVisible();

  // Drive chat.sendFile through the preload bridge to bypass the native
  // file picker (chat.pickFile is exercised in unit tests; we want the
  // renderer→main→fake-server roundtrip here, not the native dialog).
  const sendResult = await window.evaluate(async (path: string) => {
    const w = window as unknown as {
      clawnet: {
        invoke: (
          ch: string,
          payload: unknown,
        ) => Promise<{ ok: true; data: { id: string; contentType: string; content: Record<string, unknown> } } | { ok: false; error: { code: string; message: string } }>;
      };
    };
    return w.clawnet.invoke('chat.sendFile', {
      conversationId: 'c-agent',
      localPath: path,
    });
  }, localFile);

  expect(sendResult.ok).toBe(true);
  if (sendResult.ok) {
    expect(sendResult.data.contentType).toBe('file');
    expect(sendResult.data.content).toMatchObject({ name: 'hello.txt' });
  }

  // File bubble visible with the file name
  await expect(window.getByText('hello.txt').first()).toBeVisible({ timeout: 5_000 });

  // The bubble carries our data-testid (set by FileMessageBubble).
  await expect(window.getByTestId('file-bubble').first()).toBeVisible();

  // Download interaction would open a native Save dialog — covered by unit
  // tests on the main-side handler. The renderer→main→fake-server roundtrip
  // is what this spec proves.
});
