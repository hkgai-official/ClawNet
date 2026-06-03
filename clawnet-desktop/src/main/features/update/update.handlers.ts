// src/main/features/update/update.handlers.ts
import type { IpcRouter } from '../../core/ipc-router';
import type { IpcEvents } from '../../core/ipc-events';
import { Requests as IpcRequests } from '../../../shared/ipc-contract';
import type { UpdateService } from './update.service';

export function registerUpdateHandlers(
  router: IpcRouter,
  events: IpcEvents,
  svc: UpdateService,
): void {
  router.register('app.checkForUpdates', {
    input: IpcRequests['app.checkForUpdates'].input,
    output: IpcRequests['app.checkForUpdates'].output,
    handler: async () => svc.checkForUpdates(),
  });
  router.register('app.quitAndInstall', {
    input: IpcRequests['app.quitAndInstall'].input,
    output: IpcRequests['app.quitAndInstall'].output,
    handler: async () => { svc.quitAndInstall(); },
  });
  // Push status changes to the renderer.
  svc.onStatusChange((status) => {
    events.broadcast('app.updateStatus', status);
  });
}
