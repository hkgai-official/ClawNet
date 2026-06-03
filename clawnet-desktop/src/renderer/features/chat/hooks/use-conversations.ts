import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Conversation } from '../../../../shared/domain/chat';
import { useIpc } from '../../../hooks/use-ipc';
import { useIpcEvent } from '../../../hooks/use-ipc-event';

export function useConversations() {
  const ipc = useIpc();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['chat.conversations'],
    queryFn: () => ipc('chat.conversations.list', {}),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['chat.conversations'] });
  useIpcEvent('chat.message.created', invalidate);

  // Server push: conversation summary was updated. macOS patches in
  // place (handleConversationUpdated); we follow the same pattern to
  // avoid a full refetch over the wire.
  useIpcEvent('conversation.updated', (p) => {
    qc.setQueryData<Conversation[]>(['chat.conversations'], (prev) => {
      if (!prev) return prev;
      return prev.map((c) =>
        c.id === p.conversationId ? { ...c, summary: p.summary } : c,
      );
    });
  });

  // Server push: group member roster changed, OR a server-side dialog
  // event (`dialog.approval_request` / `dialog.request_sent`) triggered
  // background work that may resort the conversation list. Both are
  // infrequent — a full refetch is cheapest.
  useIpcEvent('group.members.changed', invalidate);
  useIpcEvent('chat.conversations.refresh', invalidate);

  return query;
}
