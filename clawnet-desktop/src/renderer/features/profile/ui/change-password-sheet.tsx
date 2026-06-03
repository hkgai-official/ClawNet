// src/renderer/features/profile/ui/change-password-sheet.tsx
//
// Mirrors macOS ChangePasswordView.swift:1-138.
// Local validation:
//   - new !== confirm → error
//   - new === old → error
//   - new.length < 6 → submit disabled
// Calls auth.changePassword (wired P1B). On success: show checkmark 1.5 s,
// then dismiss.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { useIpc } from '../../../hooks/use-ipc';
import { Button } from '../../../components/ui/button';
import { Sheet, SheetHeader, SheetBody, SheetFooter } from '../../../components/ui/sheet';

interface Props {
  onClose: () => void;
}

export function ChangePasswordSheet({ onClose }: Props) {
  const { t } = useTranslation('profile');
  const ipc = useIpc();
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const change = useMutation({
    mutationFn: async () =>
      ipc('auth.changePassword', { oldPassword: oldPw, newPassword: newPw }),
  });

  const submitEnabled =
    oldPw.length > 0 &&
    newPw.length >= 6 &&
    confirmPw.length > 0 &&
    !change.isPending &&
    !success;

  async function submit() {
    setError(null);
    // Mirror macOS ChangePasswordView.swift:112-119 — mismatch check first,
    // then same-as-old.
    if (newPw !== confirmPw) {
      setError(t('passwordMismatch'));
      return;
    }
    if (newPw === oldPw) {
      setError(t('passwordSameAsOld'));
      return;
    }
    try {
      await change.mutateAsync();
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
    }
  }

  return (
    <Sheet open onClose={onClose} size="sm">
      <SheetHeader onClose={onClose}>{t('changePassword')}</SheetHeader>
      <SheetBody>
        <PasswordField
          placeholder={t('currentPassword')}
          value={oldPw}
          onChange={setOldPw}
          autoFocus
        />
        <PasswordField
          placeholder={t('newPasswordPlaceholder')}
          value={newPw}
          onChange={setNewPw}
        />
        <PasswordField
          placeholder={t('confirmNewPassword')}
          value={confirmPw}
          onChange={setConfirmPw}
        />

        {error && (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-danger)' }}>
            {error}
          </p>
        )}
        {success && (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-success)' }}>
            {t('passwordChanged')}
          </p>
        )}
      </SheetBody>
      <SheetFooter>
        <Button variant="secondary" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button variant="primary" onClick={submit} disabled={!submitEnabled}>
          {change.isPending ? t('saving') : t('confirmChanges')}
        </Button>
      </SheetFooter>
    </Sheet>
  );
}

function PasswordField({
  placeholder,
  value,
  onChange,
  autoFocus,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <input
      type="password"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
      style={{
        width: '100%',
        padding: '10px 12px',
        fontSize: 14,
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg-app)',
        color: 'var(--color-text-primary)',
        boxSizing: 'border-box',
      }}
    />
  );
}
