// src/main/features/profile/profile.handlers.ts
import type { IpcRouter } from '../../core/ipc-router';
import { Requests as IpcRequests } from '../../../shared/ipc-contract';
import type { ProfileService } from './profile.service';

/**
 * Wires `profile.*` IPC channels to the main-process ProfileService.
 * 1:1 with macOS ClawNetAPI.swift:91-116 entry points.
 */
export function registerProfileHandlers(router: IpcRouter, profile: ProfileService): void {
  router.register('profile.get', {
    input: IpcRequests['profile.get'].input,
    output: IpcRequests['profile.get'].output,
    handler: async () => profile.getMe(),
  });
  router.register('profile.update', {
    input: IpcRequests['profile.update'].input,
    output: IpcRequests['profile.update'].output,
    handler: async (input) => profile.updateMe(input),
  });
  router.register('profile.setLanguage', {
    input: IpcRequests['profile.setLanguage'].input,
    output: IpcRequests['profile.setLanguage'].output,
    handler: async ({ language }) => { await profile.setLanguage(language); },
  });
}
