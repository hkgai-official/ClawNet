import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useContacts } from '../hooks/use-contacts';
import { useContactsStore } from '../state/contacts-slice';
import { useIpc } from '../../../hooks/use-ipc';
import { useChatStore } from '../../chat/state/chat-slice';
import { useTags } from '../../tags/hooks/use-tags';
import { Button } from '../../../components/ui/button';

/**
 * Read-only contact detail panel. Ports `ContactDetailView` from
 * macOS ContactDetailView.swift:1-130. P3A Task 13 adds an editable
 * tag selector (swift lines 80-96 equivalent) that calls the
 * contacts.updateTag IPC handler registered in Task 5.
 */
export interface ContactDetailViewProps {
  /** Called after a DM is created so the parent can switch panels to chat. */
  onOpenChat?: () => void;
}

export function ContactDetailView({ onOpenChat }: ContactDetailViewProps = {}) {
  const { t } = useTranslation(['contacts', 'tags']);
  const ipc = useIpc();
  const qc = useQueryClient();
  const selectedId = useContactsStore((s) => s.selectedContactId);
  const contacts = useContacts();
  const tagsQuery = useTags();
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);

  const updateContactTag = useMutation({
    mutationFn: (vars: { contactId: string; tagId: string | null }) =>
      ipc('contacts.updateTag', vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contacts.list'] });
    },
  });

  if (!selectedId) return null;
  const contact = contacts.data?.find((c) => c.id === selectedId);
  if (!contact) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--color-text-muted)',
      }}>
        {t('contacts:contactNotFound')}
      </div>
    );
  }

  const initial = contact.displayName.slice(0, 1).toUpperCase();
  const isAgent = contact.type === 'agent';
  const tags = tagsQuery.data ?? [];

  const onStartChat = async () => {
    const conv = await ipc('chat.createDirectConversation', { participantId: contact.id });
    await qc.invalidateQueries({ queryKey: ['chat.conversations'] });   // ← NEW
    setActiveConversation(conv.id);
    // Without this the conversation becomes active but the user is still
    // on the contacts panel, so the chat window never appears. Mirrors
    // macOS ContactDetailView.swift which routes through NavigationManager.
    onOpenChat?.();
  };

  return (
    <div style={{
      flex: 1, padding: 32, maxWidth: 480, margin: '0 auto',
      display: 'flex', flexDirection: 'column', gap: 24,
    }}>
      {/* Avatar */}
      <div style={{
        width: 80, height: 80, borderRadius: '50%', alignSelf: 'center',
        background: isAgent ? 'var(--color-purple-badge-bg)' : 'var(--color-info-badge-bg)',
        color: isAgent ? 'var(--color-purple)' : 'var(--color-info)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 32, fontWeight: 600,
      }}>
        {initial}
      </div>

      {/* Name + type */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 700 }}>{contact.displayName}</span>
          {isAgent && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
              background: 'var(--color-purple-badge-bg)', color: 'var(--color-purple)',
            }}>AI</span>
          )}
        </div>
        {contact.status && (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{contact.status}</div>
        )}
      </div>

      {/* Info card */}
      <div style={{
        background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border-subtle)', overflow: 'hidden',
      }}>
        {contact.userCode && <InfoRow label="ID" value={contact.userCode} />}
        {contact.email && <InfoRow label={t('contacts:email')} value={contact.email} />}
        {contact.nickname && <InfoRow label={t('contacts:nickname')} value={contact.nickname} />}
        {contact.phone && <InfoRow label={t('contacts:phone')} value={contact.phone} />}
        {/* Tag selector is only meaningful for human contacts. macOS guards
            with `if contact.type == .human` (ContactDetailView.swift:80) —
            tagging an agent has no defined server semantics. */}
        {!isAgent && (
          <TagSelectRow
            label={t('contacts:tag')}
            value={contact.tagId ?? ''}
            disabled={updateContactTag.isPending}
            onChange={(nextTagId) =>
              updateContactTag.mutate({ contactId: contact.id, tagId: nextTagId || null })
            }
            options={tags.map((tag) => ({ id: tag.id, label: tag.displayName }))}
            noTagLabel={t('tags:noTag')}
          />
        )}
        <InfoRow
          label={t('contacts:type')}
          value={isAgent ? t('contacts:agent') : t('contacts:user')}
          last
        />
      </div>

      {/* Send message action */}
      <Button variant="primary" onClick={() => { void onStartChat(); }}>
        {t('contacts:sendMessage')}
      </Button>
    </div>
  );
}

function InfoRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{
      padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
      borderBottom: last ? 'none' : '1px solid var(--color-border-subtle)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', minWidth: 60 }}>{label}</div>
      <div style={{ flex: 1, fontSize: 13, userSelect: 'text' }}>{value}</div>
    </div>
  );
}

function TagSelectRow({
  label,
  value,
  onChange,
  options,
  noTagLabel,
  disabled = false,
  last = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ id: string; label: string }>;
  noTagLabel: string;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <div style={{
      padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
      borderBottom: last ? 'none' : '1px solid var(--color-border-subtle)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', minWidth: 60 }}>{label}</div>
      <select
        data-testid="contact-tag-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1,
          fontSize: 13,
          padding: '4px 8px',
          background: 'var(--color-bg-surface-2)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-text-primary)',
        }}
      >
        <option value="">{noTagLabel}</option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
