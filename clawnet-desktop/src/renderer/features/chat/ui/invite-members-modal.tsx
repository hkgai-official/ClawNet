import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useContacts } from '../../contacts/hooks/use-contacts';
import { useGroupStore } from '../state/group-slice';
import { useMembers, useAddMembers } from '../hooks/use-group';
import { Button } from '../../../components/ui/button';
import { Sheet, SheetHeader, SheetBody, SheetFooter } from '../../../components/ui/sheet';
import { toastStore } from '../../../components/toast-overlay';

/**
 * Invite-Members modal for an existing group conversation. 1:1 port of macOS
 * `InviteMembersSheet.swift` for the `existingConversationId != nil` branch —
 * pre-filters out contacts who are already members and submits via
 * `useAddMembers`.
 *
 * The active conversation comes from `useGroupStore.inviteModalForConversationId`;
 * setting that to non-null opens the modal, clearing it closes it.
 */
export function InviteMembersModal() {
  const { t } = useTranslation('chat');
  const conversationId = useGroupStore((s) => s.inviteModalForConversationId);
  const close = useGroupStore((s) => s.closeInviteModal);
  const contacts = useContacts();
  const members = useMembers(conversationId);
  const addMembers = useAddMembers(conversationId ?? '');

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const memberIds = new Set(members.data?.map((m) => m.id) ?? []);
  const candidates = contacts.data?.filter(
    (c) => c.type === 'human' && !memberIds.has(c.id),
  ) ?? [];

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const closeAndReset = () => { setSelected(new Set()); close(); };

  const onSubmit = () => {
    if (selected.size === 0) return;
    addMembers.mutate([...selected], {
      onSuccess: closeAndReset,
      onError: () => toastStore.getState().push({
        message: t('group.inviteFailed'),
        level: 'error',
      }),
    });
  };

  return (
    <Sheet open={conversationId !== null} onClose={closeAndReset} size="sm" testId="invite-members-modal">
      <SheetHeader onClose={closeAndReset}>{t('group.inviteMembers')}</SheetHeader>
      <SheetBody>
        <div
          style={{
            maxHeight: 320, overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}
        >
          {candidates.map((c) => {
            const isSelected = selected.has(c.id);
            return (
              <button
                key={c.id}
                data-testid={`invite-contact-${c.id}`}
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
          {candidates.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', padding: 8 }}>
              {t('group.noMembers')}
            </div>
          )}
        </div>
      </SheetBody>
      <SheetFooter>
        <Button size="sm" variant="ghost" onClick={closeAndReset}>
          {t('group.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={selected.size === 0 || addMembers.isPending}
          onClick={onSubmit}
        >
          {t('group.invite')}
        </Button>
      </SheetFooter>
    </Sheet>
  );
}
