import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useContactSearch, useContacts } from '../hooks/use-contacts';
import { useSendFriendRequest } from '../hooks/use-friend-requests';
import { useContactsStore } from '../state/contacts-slice';
import { Button } from '../../../components/ui/button';
import { Sheet, SheetHeader, SheetBody, SheetFooter } from '../../../components/ui/sheet';
import { toastStore } from '../../../components/toast-overlay';

/**
 * Modal for searching the server by ID/username/email and sending a
 * friend request. Ports `AddContactSheet` from
 * macOS ContactsPanel.swift:236-332.
 */
export function AddContactModal() {
  const { t } = useTranslation('contacts');
  const open = useContactsStore((s) => s.addContactModalOpen);
  const close = useContactsStore((s) => s.closeAddContactModal);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState(false);
  // Optional "with-request" message — macOS AddContactSheet.swift:243
  // includes this field; mirrors the friend-request server payload.
  const [message, setMessage] = useState('');

  const search = useContactSearch(submitted ? query : '');
  const contacts = useContacts();
  const send = useSendFriendRequest();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSubmitted(true);
  };

  const handleApply = (toUserId: string) => {
    const trimmed = message.trim();
    const vars: { toUserId: string; message?: string } = { toUserId };
    if (trimmed) vars.message = trimmed;
    send.mutate(
      vars,
      {
        onSuccess: () => toastStore.getState().push({
          message: t('requestSent', { defaultValue: 'Request sent' }),
          level: 'success',
        }),
        onError: () => toastStore.getState().push({
          message: t('sendFailed', { defaultValue: 'Send failed' }),
          level: 'error',
        }),
      },
    );
  };

  return (
    <Sheet open={open} onClose={close} size="sm">
      <SheetHeader onClose={close}>{t('addFriend')}</SheetHeader>
      <SheetBody>
        <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8 }}>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSubmitted(false); }}
            placeholder={t('idUsernameOrEmail', { defaultValue: 'ID, username, or email' })}
            style={{
              flex: 1, padding: '6px 10px', fontSize: 13,
              background: 'var(--color-bg-surface-2)', border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)',
            }}
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!query.trim()}>
            {t('search')}
          </Button>
        </form>

        {search.isLoading && (
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{t('loading')}</div>
        )}
        {submitted && search.data?.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {t('userNotFound')}
          </div>
        )}
        {search.data && search.data.length > 0 && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
              {t('requestMessage', { defaultValue: 'Message (optional)' })}
            </span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('requestMessagePlaceholder', {
                defaultValue: 'Say hi, mention how you know them…',
              })}
              rows={2}
              maxLength={200}
              style={{
                padding: '6px 10px',
                fontSize: 13,
                background: 'var(--color-bg-surface-2)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-primary)',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </label>
        )}
        {search.data && search.data.length > 0 && (
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {search.data.map((c) => {
              const alreadyFriend = contacts.data?.some((ct) => ct.id === c.id);
              return (
                <div key={c.id} data-testid={`search-result-${c.id}`} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: 6,
                  background: 'var(--color-bg-surface-2)', borderRadius: 'var(--radius-sm)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>{c.displayName}</div>
                    {c.userCode && (
                      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                        ID: {c.userCode}
                      </div>
                    )}
                  </div>
                  {alreadyFriend ? (
                    <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                      {t('alreadyFriend')}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => handleApply(c.id)}
                      disabled={send.isPending}
                    >
                      {t('apply')}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SheetBody>
      <SheetFooter>
        <Button size="sm" variant="ghost" onClick={close}>{t('close')}</Button>
      </SheetFooter>
    </Sheet>
  );
}
