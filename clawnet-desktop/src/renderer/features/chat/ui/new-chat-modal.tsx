import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useContacts } from '../../contacts/hooks/use-contacts';
import { useIpc } from '../../../hooks/use-ipc';
import { useGroupStore } from '../state/group-slice';
import { useChatStore } from '../state/chat-slice';
import { Button } from '../../../components/ui/button';
import { Sheet, SheetHeader, SheetBody, SheetFooter } from '../../../components/ui/sheet';
import { toastStore } from '../../../components/toast-overlay';

/**
 * Single-select contact picker that creates (or reuses) a direct
 * conversation. 1:1 port of macOS `NewChatSheet`
 * (ChatContainerView.swift:315-460), minus the optional-title input for
 * agent conversations — Win's `chat.createDirectConversation` IPC
 * doesn't yet plumb a title through, so we mirror the human-DM path for
 * both contact types (server dedups). The "Create Group" button hands
 * off to the existing NewGroupModal.
 */
export function NewChatModal() {
  const { t } = useTranslation('chat');
  const open = useGroupStore((s) => s.newChatModalOpen);
  const close = useGroupStore((s) => s.closeNewChatModal);
  const openNewGroupModal = useGroupStore((s) => s.openNewGroupModal);
  const openAgentDialogWizard = useGroupStore((s) => s.openAgentDialogWizard);
  const contacts = useContacts();
  const ipc = useIpc();
  const setActive = useChatStore((s) => s.setActiveConversation);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const createDirect = useMutation({
    mutationFn: (participantId: string) =>
      ipc('chat.createDirectConversation', { participantId }),
  });

  const reset = () => setSelectedId(null);
  const closeAndReset = () => { reset(); close(); };

  const onCreate = () => {
    if (!selectedId) return;
    createDirect.mutate(selectedId, {
      onSuccess: (conv) => {
        setActive(conv.id);
        closeAndReset();
      },
      onError: () => toastStore.getState().push({
        message: t('newChat.createFailed', { defaultValue: 'Failed to create conversation' }),
        level: 'error',
      }),
    });
  };

  const onCreateGroup = () => { closeAndReset(); openNewGroupModal(); };
  const onStartAgentDialog = () => { closeAndReset(); openAgentDialogWizard(); };

  return (
    <Sheet open={open} onClose={closeAndReset} size="sm" testId="new-chat-modal">
      <SheetHeader onClose={closeAndReset}>
        {t('newChat.title', { defaultValue: 'New Conversation' })}
      </SheetHeader>
      <SheetBody>
        {contacts.data && contacts.data.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              padding: '40px 0',
              color: 'var(--color-text-muted)',
              fontSize: 13,
            }}
          >
            {t('newChat.noContacts', {
              defaultValue: 'No contacts yet — add one first.',
            })}
          </div>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              maxHeight: 320,
              overflowY: 'auto',
            }}
          >
            {(contacts.data ?? []).map((c) => {
              const isAgent = c.type === 'agent';
              const isSelected = selectedId === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    data-testid={`new-chat-contact-${c.id}`}
                    onClick={() => setSelectedId(c.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      background: isSelected
                        ? 'var(--color-bg-surface-2)'
                        : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--color-border-subtle)',
                    }}
                  >
                    <div
                      aria-hidden
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 13,
                        fontWeight: 600,
                        background: isAgent
                          ? 'var(--color-purple-badge-bg)'
                          : 'var(--color-info-badge-bg)',
                        color: isAgent ? 'var(--color-purple)' : 'var(--color-info)',
                      }}
                    >
                      {c.displayName.slice(0, 1).toUpperCase()}
                    </div>
                    <span
                      style={{
                        fontSize: 14,
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {c.displayName}
                    </span>
                    {isAgent && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'var(--color-purple-badge-bg)',
                          color: 'var(--color-purple)',
                        }}
                      >
                        AI
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </SheetBody>
      <SheetFooter>
        <Button variant="ghost" onClick={onCreateGroup}>
          {t('newChat.createGroup', { defaultValue: 'Create Group' })}
        </Button>
        <Button variant="ghost" onClick={onStartAgentDialog}>
          {t('newChat.startAgentDialog', { defaultValue: 'Start Agent Dialog' })}
        </Button>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={closeAndReset}>
          {t('newChat.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button
          variant="primary"
          disabled={!selectedId || createDirect.isPending}
          onClick={onCreate}
        >
          {t('newChat.create', { defaultValue: 'Create' })}
        </Button>
      </SheetFooter>
    </Sheet>
  );
}
