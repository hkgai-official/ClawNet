import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useContacts } from '../../contacts/hooks/use-contacts';
import { useGroupStore } from '../state/group-slice';
import { useCreateGroup } from '../hooks/use-group';
import { useChatStore } from '../state/chat-slice';
import { Button } from '../../../components/ui/button';
import { Sheet, SheetHeader, SheetBody, SheetFooter } from '../../../components/ui/sheet';
import { toastStore } from '../../../components/toast-overlay';

/**
 * Multi-select contact picker → optional title input → "Create" calls
 * `useCreateGroup`. 1:1 port of macOS `InviteMembersSheet.swift` for the
 * `isNewGroup` branch (existingConversationId == nil).
 *
 * On success: switches the active conversation to the freshly-created group
 * and closes the modal.
 */
export function NewGroupModal() {
  const { t } = useTranslation('chat');
  const open = useGroupStore((s) => s.newGroupModalOpen);
  const close = useGroupStore((s) => s.closeNewGroupModal);
  const contacts = useContacts();
  const createGroup = useCreateGroup();
  // `setActiveConversation` is the canonical chat-slice action (verified
  // during P2C — Task 13 corrected a stale `setActiveConversationId` ref).
  const setActive = useChatStore((s) => s.setActiveConversation);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const reset = () => {
    setSelected(new Set());
    setTitle('');
  };
  const closeAndReset = () => { reset(); close(); };

  const onCreate = () => {
    if (selected.size < 2) return;
    const trimmedTitle = title.trim();
    const vars: { participantIds: string[]; title?: string } = {
      participantIds: [...selected],
    };
    if (trimmedTitle.length > 0) vars.title = trimmedTitle;
    createGroup.mutate(vars, {
      onSuccess: (conv) => {
        setActive(conv.id);
        closeAndReset();
      },
      onError: () => toastStore.getState().push({
        message: t('group.createGroupFailed'),
        level: 'error',
      }),
    });
  };

  return (
    <Sheet open={open} onClose={closeAndReset} size="sm" testId="new-group-modal">
      <SheetHeader onClose={closeAndReset}>{t('group.newGroup')}</SheetHeader>
      <SheetBody>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('group.titleOptional')}
          style={{
            padding: '6px 10px', fontSize: 13,
            background: 'var(--color-bg-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-primary)',
          }}
        />

        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
          {t('group.selectMembers')} {selected.size > 0 && `(${selected.size})`}
        </div>

        <div
          style={{
            maxHeight: 320, overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}
        >
          {contacts.data?.filter((c) => c.type === 'human').map((c) => {
            const isSelected = selected.has(c.id);
            return (
              <button
                key={c.id}
                data-testid={`new-group-contact-${c.id}`}
                onClick={() => toggle(c.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: 6,
                  background: isSelected ? 'var(--color-info-badge-bg)' : 'var(--color-bg-surface-2)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: 'var(--color-text-primary)',
                }}
              >
                <input type="checkbox" checked={isSelected} readOnly tabIndex={-1} />
                <div style={{ flex: 1, fontSize: 13 }}>{c.displayName}</div>
              </button>
            );
          })}
        </div>

        {selected.size < 2 && (
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
            {t('group.selectAtLeastTwo')}
          </div>
        )}
      </SheetBody>
      <SheetFooter>
        <Button size="sm" variant="ghost" onClick={closeAndReset}>
          {t('group.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={selected.size < 2 || createGroup.isPending}
          onClick={onCreate}
        >
          {t('group.create')}
        </Button>
      </SheetFooter>
    </Sheet>
  );
}
