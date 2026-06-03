// src/main/features/auth/auth.events.ts
import type { IpcEvents } from '../../core/ipc-events';
import type { AuthState } from '../../../shared/domain/auth';

export function emitAuthState(events: IpcEvents, state: AuthState): void {
  events.broadcast('auth.stateChanged', state);
}

export function emitAuthUserSwitched(events: IpcEvents, userId: string): void {
  events.broadcast('auth.userSwitched', { userId });
}
