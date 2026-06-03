// e2e/fixtures/launch-app.ts
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface LaunchResult {
  app: ElectronApplication;
  window: Page;
  userDataDir: string;
  close: () => Promise<void>;
}

export interface LaunchOptions {
  serverURL: string;
  /**
   * Files to drop into the userData dir before electron boots. Used by
   * P3C-agent-exec specs that need a pre-loaded bookmark
   * (`file_access.json`) so CommandPolicy.check passes its bookmark gate
   * without waiting on the async post-auth `/api/v1/file-access/settings`
   * sync. Keys are relative paths under userData.
   */
  seedUserData?: Record<string, string>;
  /**
   * Override the userData directory used by this Electron instance. When
   * provided, the caller is responsible for cleanup (the returned `close()`
   * helper will NOT delete it). Omit to have launchApp create and auto-clean
   * a fresh tmp dir per the existing behaviour.
   *
   * Used by the P3E SQLite persistence spec (spec 23) which needs to reuse
   * the same userDataDir across two successive app launches so the second
   * launch can verify the DB file written by the first.
   */
  userDataDir?: string;
}

export async function launchApp(opts: LaunchOptions): Promise<LaunchResult> {
  const ownedDir = !opts.userDataDir;
  const userDataDir = opts.userDataDir ?? mkdtempSync(join(tmpdir(), 'clawnet-e2e-'));
  if (opts.seedUserData) {
    for (const [relPath, contents] of Object.entries(opts.seedUserData)) {
      writeFileSync(join(userDataDir, relPath), contents, { mode: 0o600 });
    }
  }
  const app = await electron.launch({
    args: ['./out/main/index.js'],
    env: {
      ...process.env,
      CLAWNET_USER_DATA_DIR: userDataDir,
      CLAWNET_E2E_SERVER_URL: opts.serverURL,
      // Window visibility modes (in priority order):
      //   CLAWNET_E2E_NO_FOCUS=1  → window visible at saved position, but
      //                             uses showInactive() so it doesn't
      //                             snatch focus. Useful for watching test
      //                             runs while continuing to type elsewhere.
      //   CLAWNET_E2E_OFFSCREEN=1 → window positioned at (-32000,-32000)
      //                             so it's invisible to the host user.
      //                             Default for darwin (suppresses Dock
      //                             bounce + visual noise).
      //   neither / both =0       → normal show() at saved position.
      // Pass either env var when running playwright. NO_FOCUS wins when
      // both are set (window itself implements the precedence).
      CLAWNET_E2E_OFFSCREEN: process.env.CLAWNET_E2E_NO_FOCUS === '1'
        ? '0'
        : (process.env.CLAWNET_E2E_OFFSCREEN ?? '1'),
      ...(process.env.CLAWNET_E2E_NO_FOCUS ? { CLAWNET_E2E_NO_FOCUS: process.env.CLAWNET_E2E_NO_FOCUS } : {}),
      // P3F: never let the test app contact GitHub for autoUpdate probing.
      // main/index.ts gates `updateSvc.start()` + the 5s checkForUpdates kick-off
      // behind `process.env.CLAWNET_DISABLE_AUTO_UPDATE !== '1'`.
      CLAWNET_DISABLE_AUTO_UPDATE: '1',
    },
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return {
    app,
    window,
    userDataDir,
    close: async () => {
      await app.close();
      // Only clean up the tmp dir if we created it. When the caller supplied
      // a `userDataDir` override (e.g. spec 23 reuses it across restarts)
      // cleanup is the caller's responsibility.
      if (ownedDir) rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}
