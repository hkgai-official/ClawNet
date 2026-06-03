import { useTranslation } from 'react-i18next';
import { useIpcEvent } from '../../../hooks/use-ipc-event';
import { useAuthStore } from '../../auth/state/auth-slice';
import { useChatStore } from '../state/chat-slice';
import { toastStore } from '../../../components/toast-overlay';
import { shouldShowMessageToast } from './message-toast-policy';
import type { ChatMessage } from '../../../../shared/domain/chat';

/**
 * Surfaces an in-app banner for new messages that arrive in a conversation
 * other than the active one. macOS uses a system notification via
 * NotificationService.swift; the Win port hasn't wired the OS-level
 * Notification yet, but an in-app toast is a
 * lighter step that still keeps users aware of background traffic.
 *
 * Whether a message toasts is decided by `shouldShowMessageToast`:
 * human sender only (no agent / system / A2A protocol noise), not the
 * user's own send, not the conversation already on screen.
 *
 * Clicking the toast switches the active conversation to the sender's
 * conv. The hook does NOT itself flip the visible panel from contacts /
 * settings to chat — the toast just sets activeConversationId, and the
 * onOpenChat callback (passed by App.tsx) handles the panel swap.
 */
export function useMessageNotifications(onOpenChat?: () => void) {
  const { t } = useTranslation('chat');

  useIpcEvent('chat.message.created', (m: ChatMessage) => {
    const auth = useAuthStore.getState().state;
    const currentUserId = auth.kind === 'loggedIn' ? auth.user.id : null;
    const activeId = useChatStore.getState().activeConversationId;
    const setActive = useChatStore.getState().setActiveConversation;

    if (!shouldShowMessageToast(m, currentUserId, activeId)) return;

    const preview = previewFor(m, t);
    const title = m.sender.name || t('newMessage', { defaultValue: 'New message' });

    toastStore.getState().push({
      level: 'info',
      title,
      message: preview || `[${m.contentType}]`,
      onClick: () => {
        if (m.conversationId) setActive(m.conversationId);
        onOpenChat?.();
      },
    });
  });
}

function previewFor(
  m: ChatMessage,
  t: ReturnType<typeof useTranslation<'chat'>>['t'],
): string {
  if (m.contentType === 'text') {
    const c = m.content as { text?: string | null };
    const text = (c.text ?? '').trim();
    if (text.length === 0) return '';
    return text.length > 100 ? text.slice(0, 100) + '…' : text;
  }
  if (m.contentType === 'image') return t('preview.image', { defaultValue: '🖼 Image' });
  if (m.contentType === 'video') return t('preview.video', { defaultValue: '🎬 Video' });
  if (m.contentType === 'voice') return t('preview.voice', { defaultValue: '🎤 Voice message' });
  if (m.contentType === 'file') return t('preview.file', { defaultValue: '📎 File' });
  return '';
}
