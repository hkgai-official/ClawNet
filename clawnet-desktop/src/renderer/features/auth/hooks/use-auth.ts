import { useCallback, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';
import { useIpcEvent } from '../../../hooks/use-ipc-event';
import { useAuthStore } from '../state/auth-slice';

export function useAuth() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const state = useAuthStore((s) => s.state);
  const applyServerEvent = useAuthStore((s) => s.applyServerEvent);

  useIpcEvent('auth.stateChanged', (s) => applyServerEvent(s));
  // Account just changed on this install — every query in the cache
  // (conversations, agents, tags, contacts, …) was loaded for the
  // previous user. Nuke the whole cache so the new user sees a clean
  // slate; the next render's queries will refetch fresh data.
  useIpcEvent('auth.userSwitched', () => qc.clear());

  useEffect(() => {
    // Only restore on initial mount when we don't yet know we're logged in.
    // Otherwise MainShell re-mounting (e.g. after login) would re-invoke
    // restoreSession and stomp on the freshly-emitted loggedIn user with the
    // fallback identity reconstructed from credentials.
    if (state.kind === 'loggedIn') return;
    void ipc('auth.restoreSession', {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ipc]);

  const login = useMutation({
    mutationFn: async (vars: { serverURL: string; username: string; password: string }) =>
      ipc('auth.login', vars),
  });

  const logout = useMutation({
    mutationFn: async () => ipc('auth.logout', {}),
  });

  const updateServerURL = useCallback(
    async (serverURL: string) => { await ipc('auth.updateServerURL', { serverURL }); },
    [ipc],
  );

  return { state, login, logout, updateServerURL };
}
