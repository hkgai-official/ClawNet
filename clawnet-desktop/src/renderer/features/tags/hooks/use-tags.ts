// src/renderer/features/tags/hooks/use-tags.ts
//
// React Query wrappers around the tags.* IPC channels. The renderer talks
// to main via `useIpc()` (shared/clawnet-api) which already unwraps the
// Result<T, string> envelope and throws IpcInvocationError on failure —
// so we do NOT redeclare `window.api` here; the codebase global is
// `window.clawnet` and is declared in src/renderer/window.d.ts.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateTagInput, UpdateTagInput } from '../../../../shared/domain/tag';
import { useIpc } from '../../../hooks/use-ipc';

const QK_TAGS = ['tags'] as const;

export function useTags() {
  const ipc = useIpc();
  return useQuery({
    queryKey: QK_TAGS,
    queryFn: () => ipc('tags.list', {}),
  });
}

export function useCreateTag() {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTagInput) => ipc('tags.create', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK_TAGS });
    },
  });
}

export function useUpdateTag() {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string } & UpdateTagInput) =>
      ipc('tags.update', vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK_TAGS });
    },
  });
}

export function useDeleteTag() {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc('tags.delete', { id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK_TAGS });
    },
  });
}
