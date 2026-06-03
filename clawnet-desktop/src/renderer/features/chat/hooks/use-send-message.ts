import { useMutation } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';

export function useSendMessage() {
  const ipc = useIpc();
  return useMutation({
    mutationFn: async (vars: { conversationId: string; text: string }) =>
      ipc('chat.messages.sendText', vars),
  });
}
