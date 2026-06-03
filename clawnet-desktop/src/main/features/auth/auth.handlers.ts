// src/main/features/auth/auth.handlers.ts
import { Requests } from '../../../shared/ipc-contract';
import type { IpcRouter } from '../../core/ipc-router';
import type { AuthService } from './auth.service';

export function registerAuthHandlers(router: IpcRouter, svc: AuthService): void {
  router.register('auth.login', {
    input: Requests['auth.login'].input,
    output: Requests['auth.login'].output,
    handler: async ({ serverURL, username, password }) => svc.login(serverURL, username, password),
  });
  router.register('auth.logout', {
    input: Requests['auth.logout'].input,
    output: Requests['auth.logout'].output,
    handler: async () => { await svc.logout(); },
  });
  router.register('auth.restoreSession', {
    input: Requests['auth.restoreSession'].input,
    output: Requests['auth.restoreSession'].output,
    handler: async () => svc.restoreSession(),
  });
  router.register('auth.changePassword', {
    input: Requests['auth.changePassword'].input,
    output: Requests['auth.changePassword'].output,
    handler: async ({ oldPassword, newPassword }) => svc.changePassword(oldPassword, newPassword),
  });
  router.register('auth.updateServerURL', {
    input: Requests['auth.updateServerURL'].input,
    output: Requests['auth.updateServerURL'].output,
    handler: async ({ serverURL }) => { svc.updateServerURL(serverURL); },
  });
}
