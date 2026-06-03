import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';
import { useIpcEvent } from '../../../hooks/use-ipc-event';

export function useFriendRequests() {
  const ipc = useIpc();
  const qc = useQueryClient();
  // Server push: someone sent us a new friend request → refresh the
  // list so the red-dot in the nav sidebar shows up immediately.
  // macOS ChatService.handleFriendRequestNew calls
  // contactService.loadFriendRequests for the same reason.
  useIpcEvent('friend_request.new', () => {
    void qc.invalidateQueries({ queryKey: ['friendRequests.list'] });
  });
  // friend_request.accepted: refresh the contacts list so the new
  // friend appears. macOS handleFriendRequestAccepted.
  useIpcEvent('friend_request.accepted', () => {
    void qc.invalidateQueries({ queryKey: ['contacts.list'] });
    void qc.invalidateQueries({ queryKey: ['friendRequests.list'] });
  });
  return useQuery({
    queryKey: ['friendRequests.list'],
    queryFn: () => ipc('friendRequests.list', {}),
  });
}

export function useSendFriendRequest() {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { toUserId: string; message?: string }) =>
      ipc('friendRequests.send', vars),
    onSuccess: (data) => {
      // Auto-accept case: server returned status='accepted' → refresh contacts.
      // Mirrors ContactService.swift:50-54.
      if (data && data.status === 'accepted') {
        void qc.invalidateQueries({ queryKey: ['contacts.list'] });
      }
    },
  });
}

export function useAcceptFriendRequest() {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc('friendRequests.accept', { id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['friendRequests.list'] });
      void qc.invalidateQueries({ queryKey: ['contacts.list'] });
    },
  });
}

export function useRejectFriendRequest() {
  const ipc = useIpc();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc('friendRequests.reject', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friendRequests.list'] }),
  });
}
