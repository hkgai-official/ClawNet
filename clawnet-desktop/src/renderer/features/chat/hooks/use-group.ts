import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';

/**
 * TanStack hooks for P2D group conversation + member operations.
 *
 * Query keys:
 *   - `['chat.members', conversationId]` — owned by `useMembers`. Invalidated
 *     after add/remove mutations.
 *   - `['chat.conversations']` — owned by `useConversations` (P1C). Invalidated
 *     after createGroup / addMembers / removeMember / updateTitle, since each
 *     can change the sidebar (group appears, title changes, member-count
 *     subtitle changes).
 *
 * 1:1 with macOS `ChatService` callers in
 * `Views/Chat/GroupDetailView.swift` + `InviteMembersSheet.swift`.
 */

export function useMembers(conversationId: string | null) {
  const ipc = useIpc();
  return useQuery({
    queryKey: ['chat.members', conversationId],
    queryFn: async () => {
      if (!conversationId) return [];
      return ipc('chat.members.list', { conversationId });
    },
    enabled: !!conversationId,
  });
}

export function useCreateGroup() {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { participantIds: string[]; title?: string }) =>
      ipc('chat.createGroup', vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat.conversations'] });
    },
  });
}

export function useAddMembers(conversationId: string) {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (participantIds: string[]) =>
      ipc('chat.members.add', { conversationId, participantIds }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat.members', conversationId] });
      void qc.invalidateQueries({ queryKey: ['chat.conversations'] });
    },
  });
}

export function useRemoveMember(conversationId: string) {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      ipc('chat.members.remove', { conversationId, memberId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat.members', conversationId] });
      void qc.invalidateQueries({ queryKey: ['chat.conversations'] });
    },
  });
}

export function useUpdateConversationTitle(conversationId: string) {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (title: string) =>
      ipc('chat.updateTitle', { conversationId, title }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['chat.conversations'] });
    },
  });
}
