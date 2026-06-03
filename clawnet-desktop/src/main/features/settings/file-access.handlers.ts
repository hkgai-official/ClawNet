import { Requests } from '../../../shared/ipc-contract';
import type { IpcRouter } from '../../core/ipc-router';
import type { FileAccessService } from './file-access.service';
import { showOpenPathDialog } from '../../dialogs';

export function registerFileAccessHandlers(router: IpcRouter, svc: FileAccessService): void {
  router.register('settings.fileAccess.get', {
    input: Requests['settings.fileAccess.get'].input,
    output: Requests['settings.fileAccess.get'].output,
    handler: async () => {
      const s = svc.getEffectiveSettings();
      if (s) return s;
      return svc.syncFromServer();
    },
  });
  router.register('settings.fileAccess.update', {
    input: Requests['settings.fileAccess.update'].input,
    output: Requests['settings.fileAccess.update'].output,
    handler: async ({ mode, allowedPaths, deniedPaths }) =>
      svc.updateServer({ mode, allowedPaths, deniedPaths }),
  });
  router.register('settings.fileAccess.browsePath', {
    input: Requests['settings.fileAccess.browsePath'].input,
    output: Requests['settings.fileAccess.browsePath'].output,
    handler: async () => showOpenPathDialog(),
  });
}
