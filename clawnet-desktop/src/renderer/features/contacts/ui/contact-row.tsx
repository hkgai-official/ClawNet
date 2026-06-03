import type { Contact } from '../../../../shared/domain/contact';

interface Props { contact: Contact; onClick: () => void; selected: boolean }

/**
 * Sidebar row for one contact. Ports `ContactRow` from
 * macOS ContactsPanel.swift:138-181.
 */
export function ContactRow({ contact, onClick, selected }: Props) {
  const initial = contact.displayName.slice(0, 1).toUpperCase();
  const isAgent = contact.type === 'agent';

  return (
    <button
      onClick={onClick}
      data-testid={`contact-row-${contact.id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
        background: selected ? 'var(--color-bg-surface-2)' : 'transparent',
        border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer',
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isAgent ? 'var(--color-purple-badge-bg)' : 'var(--color-info-badge-bg)',
        color: isAgent ? 'var(--color-purple)' : 'var(--color-info)',
        fontWeight: 500, fontSize: 14,
        flexShrink: 0,
      }}>
        {initial}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>{contact.displayName}</span>
          {isAgent && (
            <span style={{
              fontSize: 10, fontWeight: 700,
              padding: '1px 4px', borderRadius: 3,
              background: 'var(--color-purple-badge-bg)', color: 'var(--color-purple)',
            }}>AI</span>
          )}
        </div>
        {contact.status && (
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{contact.status}</div>
        )}
      </div>
    </button>
  );
}
