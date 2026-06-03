import { create } from 'zustand';
import type { AuthState } from '../../../../shared/domain/auth';
import type { UserInfo } from '../../../../shared/domain/user';

interface AuthStore {
  state: AuthState;
  setLoggingIn: () => void;
  setLoggedIn: (user: UserInfo) => void;
  setLoggedOut: () => void;
  applyServerEvent: (s: AuthState) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  state: { kind: 'loggedOut' },
  setLoggingIn: () => set({ state: { kind: 'loggingIn' } }),
  setLoggedIn: (user) => set({ state: { kind: 'loggedIn', user } }),
  setLoggedOut: () => set({ state: { kind: 'loggedOut' } }),
  applyServerEvent: (s) => set({ state: s }),
}));
