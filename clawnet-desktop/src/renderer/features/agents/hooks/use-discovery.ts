import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';
import { useIpcEvent } from '../../../hooks/use-ipc-event';
import type { DiscoveryTask } from '../../../../shared/domain/discovery';

export function useDiscoveryByConversation(conversationId: string | null) {
  const ipc = useIpc();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['discovery.getByConv', conversationId],
    queryFn: async () => {
      if (!conversationId) return null;
      return ipc('discovery.getByConv', { conversationId });
    },
    enabled: !!conversationId,
  });

  const patch = useCallback(
    (task: DiscoveryTask) => {
      if (task.conversationId !== conversationId) return;
      qc.setQueryData(['discovery.getByConv', conversationId], task);
    },
    [qc, conversationId],
  );

  useIpcEvent('discovery.statusChanged', patch);

  return query;
}

export function useDiscoveryActions() {
  const ipc = useIpc();

  const confirm = useMutation({
    mutationFn: (vars: { id: string; queries?: Record<string, unknown>[] }) =>
      ipc('discovery.confirm', vars),
  });

  const cancel = useMutation({
    mutationFn: (vars: { id: string; reason?: string }) =>
      ipc('discovery.cancel', vars),
  });

  return { confirm, cancel };
}
