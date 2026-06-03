import { app } from 'electron';
import { join } from 'node:path';

const APP_DIR_NAME = 'ClawNet';

export const AppPaths = {
  /**
   * Must be called before app.whenReady() so subsequent app.getPath('userData')
   * returns the LocalAppData rooted directory.
   *
   * If `CLAWNET_USER_DATA_DIR` is set in the environment, that path wins. The
   * Playwright e2e launcher (`e2e/fixtures/launch-app.ts`) sets this so each
   * test run uses a fresh tmp dir with no leaked state.
   */
  initialize(): void {
    const overrideDir = process.env.CLAWNET_USER_DATA_DIR;
    if (overrideDir) {
      app.setPath('userData', overrideDir);
      return;
    }
    const localAppData =
      process.env.LOCALAPPDATA ?? app.getPath('appData');
    app.setPath('userData', join(localAppData, APP_DIR_NAME));
  },

  userData(): string {
    return app.getPath('userData');
  },

  logs(): string {
    return join(this.userData(), 'logs');
  },

  credentialsFile(): string {
    return join(this.userData(), 'credentials.bin');
  },

  fileAccessJson(): string {
    return join(this.userData(), 'file_access.json');
  },

  prefsFile(): string {
    return join(this.userData(), 'prefs.json');
  },

  messagesFile(): string {
    return join(this.userData(), 'messages.json');
  },

  downloads(): string {
    return app.getPath('downloads');
  },

  mediaCache(): string {
    return join(this.userData(), 'media-cache');
  },

  downloadsServerConfig(): string {
    return join(this.downloads(), 'server-config.json');
  },

  home(): string {
    return app.getPath('home');
  },
};
