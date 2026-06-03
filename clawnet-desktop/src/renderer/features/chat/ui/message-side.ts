import type { ChatMessage, Participant } from '../../../../shared/domain/chat';

/**
 * Whether a message is an A2A "governance" card — intent authorization,
 * dialog request, dialog approval, or a generic approval request. These
 * are system-style prompts asking the user to make a decision, so they
 * render centered in the thread rather than left/right by sender.
 */
export function isGovernanceCard(message: ChatMessage): boolean {
  const ct = message.contentType;
  if (ct === 'dialog_request' || ct === 'dialog_approval' || ct === 'approval_request') {
    return true;
  }
  if (ct === 'rich_card') {
    return (message.content as { cardType?: string }).cardType === 'intent_authorization';
  }
  return false;
}

/**
 * Whether a chat message renders on the "my side" (right-aligned, brand
 * color). 1:1 port of macOS `MessageBubble.isUser`
 * (MessageBubble.swift:17-31).
 *
 * The case the Win port previously missed: in an A2A (agent-task)
 * conversation, a message from the user's OWN agent has
 * `sender.id !== currentUserId` (it's the agent's id) but
 * `sender.ownerId === currentUserId`. Such messages are sent on the
 * user's behalf and must render on the right. The old logic
 * (`sender.id === currentUserId` only) left them stuck on the left.
 */
export function isOwnMessage(
  sender: Participant,
  currentUserId: string | null,
  isAgentDialog: boolean,
): boolean {
  // No identity yet (pre-login / restore) — fall back to human-vs-agent.
  if (!currentUserId) return sender.type === 'human';

  if (sender.id === currentUserId) return true;

  // A2A: my own agent counts as "my side" — agent dialogs only.
  if (isAgentDialog && sender.ownerId && sender.ownerId === currentUserId) {
    return true;
  }

  // Placeholder / restored / optimistic senders carry no real id —
  // fall back to the human-vs-agent heuristic.
  if (
    sender.id === 'unknown' ||
    sender.id === 'restored' ||
    sender.id.startsWith('temp-')
  ) {
    return sender.type === 'human';
  }

  return false;
}
