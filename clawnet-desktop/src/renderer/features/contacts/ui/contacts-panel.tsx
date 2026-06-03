import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useContacts } from '../hooks/use-contacts';
import {
  useFriendRequests, useAcceptFriendRequest, useRejectFriendRequest,
} from '../hooks/use-friend-requests';
import { useContactsStore } from '../state/contacts-slice';
import { ContactRow } from './contact-row';
import { FriendRequestRow } from './friend-request-row';
import { AddContactModal } from './add-contact-modal';
import { Button } from '../../../components/ui/button';
import type { Contact } from '../../../../shared/domain/contact';

function groupByFirstLetter(list: Contact[]): Record<string, Contact[]> {
  const out: Record<string, Contact[]> = {};
  for (const c of list) {
    const first = c.displayName.slice(0, 1).toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : '#';
    if (!out[letter]) out[letter] = [];
    out[letter]!.push(c);
  }
  return out;
}

/**
 * Top-level sidebar contacts panel. 1:1 with macOS ContactsPanel.swift:1-134:
 * header + search + (optional) friend-requests section + grouped contacts list
 * (by first letter; non-Latin → '#').
 */
export function ContactsPanel() {
  const { t } = useTranslation('contacts');
  const [searchText, setSearchText] = useState('');
  const selectedContactId = useContactsStore((s) => s.selectedContactId);
  const setSelectedContactId = useContactsStore((s) => s.setSelectedContactId);
  const openAddContactModal = useContactsStore((s) => s.openAddContactModal);

  const contacts = useContacts();
  const requests = useFriendRequests();
  const accept = useAcceptFriendRequest();
  const reject = useRejectFriendRequest();

  // Local filter (matches macOS ContactsPanel.swift:118-126 — case-insensitive
  // match across displayName + email + nickname).
  const filtered = useMemo(() => {
    if (!contacts.data) return [];
    if (!searchText.trim()) return contacts.data;
    const q = searchText.toLowerCase();
    return contacts.data.filter((c) =>
      c.displayName.toLowerCase().includes(q)
      || (c.email?.toLowerCase().includes(q) ?? false)
      || (c.nickname?.toLowerCase().includes(q) ?? false),
    );
  }, [contacts.data, searchText]);

  const grouped = useMemo(() => groupByFirstLetter(filtered), [filtered]);
  const letters = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  return (
    <aside
      style={{
        width: 280,
        display: 'flex', flexDirection: 'column',
        height: '100%',
        borderRight: '1px solid var(--color-border-subtle)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px' }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{t('title')}</h2>
        <Button size="sm" variant="ghost" onClick={openAddContactModal} aria-label={t('addFriend')}>＋</Button>
      </div>

      {/* Search */}
      <div style={{ padding: '0 12px 8px' }}>
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder={t('searchContact')}
          style={{
            width: '100%', padding: '6px 10px', fontSize: 13,
            background: 'var(--color-bg-surface-2)', border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Friend requests */}
        {requests.data && requests.data.length > 0 && (
          <div style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
            <div style={{
              padding: '0 12px 4px', fontSize: 11, fontWeight: 600,
              color: 'var(--color-text-secondary)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span>{t('friendRequests')}</span>
              <span style={{
                background: 'var(--color-danger)', color: 'white',
                fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
              }}>
                {requests.data.length}
              </span>
            </div>
            {requests.data.map((r) => (
              <FriendRequestRow
                key={r.id}
                request={r}
                pending={accept.isPending || reject.isPending}
                onAccept={() => accept.mutate(r.id)}
                onReject={() => reject.mutate(r.id)}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {filtered.length === 0 && !contacts.isLoading && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>👥</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t('noContacts')}</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>{t('addFriendsHint')}</div>
          </div>
        )}

        {/* Grouped contact list */}
        {letters.map((letter) => (
          <div key={letter} style={{ paddingTop: 8 }}>
            <div style={{
              padding: '0 12px 4px', fontSize: 10, fontWeight: 700,
              color: 'var(--color-text-muted)',
            }}>
              {letter}
            </div>
            {grouped[letter]?.map((c) => (
              <ContactRow
                key={c.id}
                contact={c}
                selected={c.id === selectedContactId}
                onClick={() => setSelectedContactId(c.id)}
              />
            ))}
          </div>
        ))}
      </div>

      <AddContactModal />
    </aside>
  );
}
