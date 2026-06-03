import { useContactsStore } from '../../contacts/state/contacts-slice';
import { useGlobalSearchStore } from '../state/global-search-slice';
import type { Contact } from '../../../../shared/domain/contact';

interface Props {
  contact: Contact;
  /** Switch the visible panel to `contacts` so the detail view appears. */
  onSwitchPanel: (panel: 'contacts') => void;
}

/**
 * A single contact hit. Clicking it selects the contact in the contacts
 * store and switches to the contacts panel — the existing ContactDetailView
 * picks up the selection and renders.
 */
export function ContactResultRow({ contact, onSwitchPanel }: Props) {
  const setSelected = useContactsStore((s) => s.setSelectedContactId);
  const close = useGlobalSearchStore((s) => s.close);
  const isAgent = contact.type === 'agent';

  const onClick = () => {
    setSelected(contact.id);
    onSwitchPanel('contacts');
    close();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`search-contact-${contact.id}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--color-text-primary)',
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: isAgent ? 'var(--color-purple-badge-bg)' : 'var(--color-info-badge-bg)',
          color: isAgent ? 'var(--color-purple)' : 'var(--color-info)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {contact.displayName.slice(0, 1).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13 }}>{contact.displayName}</div>
        {contact.userCode && (
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
            ID: {contact.userCode}
          </div>
        )}
      </div>
    </button>
  );
}
