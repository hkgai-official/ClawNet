// e2e/12-global-search.spec.ts
// P2F: global search palette — open via Cmd/Ctrl+F or NavSidebar icon,
// debounced parallel fanout to messages + contacts + files, click a
// message hit jumps to the conversation, scrolls to and highlights the
// matched message.
import { test, expect } from '@playwright/test';
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

async function login(window: LaunchResult['window']) {
  await window.getByLabel(/Account/i).fill('e2e@clawnet.test');
  await window.getByLabel(/Password/i).fill('any');
  await window.getByRole('button', { name: /Sign in/i }).click();
  await expect(window.getByText(/Connected/i)).toBeVisible({ timeout: 10_000 });
}

test('Cmd/Ctrl+F opens search → grouped results → click message → jumps and flashes', async () => {
  const { window } = app;
  await login(window);

  // Open via the keyboard shortcut. `process.platform` here is the Playwright
  // host, which is fine since Electron-on-mac responds to Meta+f and on
  // Windows/Linux the same handler accepts Control+f.
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
  await expect(window.getByTestId('global-search-modal')).toBeVisible({ timeout: 3000 });

  // Type a query — the fake-server returns one of each category regardless.
  await window.getByTestId('global-search-input').fill('clawnet');

  // Debounce is 300ms; allow a little extra.
  await expect(window.getByTestId('search-message-m-hello')).toBeVisible({ timeout: 2000 });
  await expect(window.getByTestId('search-contact-u-new-friend')).toBeVisible();
  await expect(window.getByTestId('search-file-f-search')).toBeVisible();

  // Click the message hit — modal closes and the active conversation jumps.
  await window.getByTestId('search-message-m-hello').click();
  await expect(window.getByTestId('global-search-modal')).not.toBeVisible({ timeout: 2000 });
  await expect(window.getByTestId('message-m-hello')).toBeVisible({ timeout: 3000 });
});

test('global search opens via NavSidebar icon too', async () => {
  const { window } = app;
  await login(window);
  await window.getByTestId('nav-search').click();
  await expect(window.getByTestId('global-search-modal')).toBeVisible({ timeout: 3000 });
});

test('Escape closes the modal', async () => {
  const { window } = app;
  await login(window);
  await window.getByTestId('nav-search').click();
  await expect(window.getByTestId('global-search-modal')).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(window.getByTestId('global-search-modal')).not.toBeVisible({ timeout: 1000 });
});
