// src/renderer/features/profile/hooks/use-profile.ts
//
// React Query wrappers around the profile.* IPC channels. Mirrors the
// P3A peer at src/renderer/features/tags/hooks/use-tags.ts — same
// useIpc + React Query shape; the IPC layer already unwraps the
// Result<T, string> envelope and throws IpcInvocationError on failure.
//
// On successful update we also push the merged UserInfo back into
// useAuthStore so other consumers (AppSidebar, message bubbles, etc.)
// don't render the stale displayName until the next /me refetch —
// this mirrors macOS ProfileSettingsView.swift:105-107.
//
// NOTE: language sync intentionally does NOT get its own hook. The
// `useLanguage` hook in src/renderer/hooks/use-i18n.ts is the single
// entry point — Task 12 extends it to invoke `profile.setLanguage`
// directly via `useIpc`, so callers stay on one API surface for both
// local + server sync.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';
import { useAuthStore } from '../../auth/state/auth-slice';
import type {
  UserProfile,
  UpdateUserProfileInput,
} from '../../../../shared/domain/user-profile';

const QK_PROFILE = ['profile', 'me'] as const;

export function useProfile() {
  const ipc = useIpc();
  return useQuery<UserProfile>({
    queryKey: QK_PROFILE,
    queryFn: () => ipc('profile.get', {}),
  });
}

export function useUpdateProfile() {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUserProfileInput) => ipc('profile.update', input),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: QK_PROFILE });
      // Mirror macOS ProfileSettingsView.swift:105-107 — push the updated
      // user back into the auth state so the rest of the UI doesn't show
      // a stale displayName until the next /me refetch.
      //
      // UserProfile fields are `string | null | undefined`; UserInfo fields
      // are `string | undefined` (no null). `?? prior` collapses both null
      // and undefined to the prior auth-store value, which is type-safe.
      const auth = useAuthStore.getState();
      if (auth.state.kind === 'loggedIn') {
        const prior = auth.state.user;
        auth.setLoggedIn({
          ...prior,
          displayName: updated.displayName,
          email: updated.email ?? prior.email,
          userCode: updated.userCode ?? prior.userCode,
          avatarUrl: updated.avatarUrl ?? prior.avatarUrl,
        });
      }
    },
  });
}
