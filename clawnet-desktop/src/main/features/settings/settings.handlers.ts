import { app } from 'electron';
import { Requests } from '../../../shared/ipc-contract';
import type { IpcRouter } from '../../core/ipc-router';
import type { SettingsService } from './settings.service';

export function registerSettingsHandlers(router: IpcRouter, svc: SettingsService): void {
  router.register('settings.theme.get', {
    input: Requests['settings.theme.get'].input,
    output: Requests['settings.theme.get'].output,
    handler: async () => svc.getTheme(),
  });
  router.register('settings.theme.set', {
    input: Requests['settings.theme.set'].input,
    output: Requests['settings.theme.set'].output,
    handler: async ({ theme }) => { svc.setTheme(theme); },
  });
  router.register('settings.language.get', {
    input: Requests['settings.language.get'].input,
    output: Requests['settings.language.get'].output,
    handler: async () => svc.getLanguage(),
  });
  router.register('settings.language.set', {
    input: Requests['settings.language.set'].input,
    output: Requests['settings.language.set'].output,
    handler: async ({ language }) => { svc.setLanguage(language); },
  });
  router.register('settings.defaultServerURL.get', {
    input: Requests['settings.defaultServerURL.get'].input,
    output: Requests['settings.defaultServerURL.get'].output,
    handler: async () =>
      process.env.CLAWNET_E2E_SERVER_URL ?? 'http://localhost:9000',
  });
  router.register('app.about.get', {
    input: Requests['app.about.get'].input,
    output: Requests['app.about.get'].output,
    handler: async () => ({
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      platform: process.platform,
    }),
  });
}
