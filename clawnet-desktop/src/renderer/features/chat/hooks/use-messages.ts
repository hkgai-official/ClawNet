import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';
import { useIpcEvent } from '../../../hooks/use-ipc-event';
import type { ChatMessage } from '../../../../shared/domain/chat';

export function useMessages(conversationId: string | null) {
  const ipc = useIpc();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['chat.messages', conversationId],
    queryFn: async () => {
      if (!conversationId) return { messages: [] as ChatMessage[], meta: null };
      return ipc('chat.messages.list', { conversationId, page: 1, pageSize: 50 });
    },
    enabled: !!conversationId,
  });

  function patchByEvent(m: ChatMessage) {
    if (m.conversationId !== conversationId) return;
    qc.setQueryData(['chat.messages', conversationId], (prev: { messages: ChatMessage[]; meta: unknown } | undefined) => {
      const messages = prev?.messages ?? [];
      const idx = messages.findIndex((x) => x.id === m.id);
      const next = idx >= 0
        ? messages.map((x) => (x.id === m.id ? m : x))
        : [...messages, m].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      return { messages: next, meta: prev?.meta ?? null };
    });
  }

  useIpcEvent('chat.message.created', patchByEvent);

  useIpcEvent('chat.message.replaced', ({ tempId, real }) => {
    if (real.conversationId !== conversationId) return;
    qc.setQueryData(['chat.messages', conversationId], (prev: { messages: ChatMessage[]; meta: unknown } | undefined) => {
      const messages = (prev?.messages ?? []).map((m) => (m.id === tempId ? real : m));
      return { messages, meta: prev?.meta ?? null };
    });
  });

  return query;
}
