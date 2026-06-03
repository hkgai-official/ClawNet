import type { ChatMessage } from '../../../../shared/domain/chat';

/**
 * Whether a newly-created message should raise an in-app notification
 * toast (the bottom-right banner). The toast means "a person messaged
 * you in a background chat", so it fires only when ALL hold:
 *
 *   - the sender is human — agent / system traffic (A2A dialog protocol
 *     messages, agent replies, dialog status) is noise and never toasts;
 *   - the message is not the current user's own send echoing back;
 *   - the conversation is not the one already on screen.
 */
export function shouldShowMessageToast(
  message: ChatMessage,
  currentUserId: string | null,
  activeConversationId: string | null,
): boolean {
  if (message.sender.type !== 'human') return false;
  if (currentUserId && message.sender.id === currentUserId) return false;
  if (
    message.conversationId &&
    message.conversationId === activeConversationId
  ) {
    return false;
  }
  return true;
}
