// src/renderer/features/profile/ui/profile-settings-panel.tsx
//
// Mirrors macOS ProfileSettingsView.swift:1-123. Shows userCode + email
// (read-only), displayName edit field, Save button, Change Password
// button which opens a sheet. Success/error message visible 3 s then clears.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProfile, useUpdateProfile } from '../hooks/use-profile';
import { ChangePasswordSheet } from './change-password-sheet';
import { Button } from '../../../components/ui/button';

export function ProfileSettingsPanel() {
  const { t } = useTranslation('profile');
  const { data: me, isLoading } = useProfile();
  const update = useUpdateProfile();
  const [displayName, setDisplayName] = useState('');
  const [savedKind, setSavedKind] = useState<'idle' | 'success' | 'error'>(
    'idle',
  );
  const [errorMsg, setErrorMsg] = useState('');
  const [showPasswordSheet, setShowPasswordSheet] = useState(false);

  // Initialize displayName once me loads; can't use useState initial because
  // the query may not be resolved on first render.
  useEffect(() => {
    if (me) setDisplayName(me.displayName);
  }, [me]);

  // Auto-clear success/error message after 3 s, matching macOS
  // ProfileSettingsView.swift:118-120.
  useEffect(() => {
    if (savedKind === 'idle') return;
    const timer = setTimeout(() => setSavedKind('idle'), 3000);
    return () => clearTimeout(timer);
  }, [savedKind]);

  async function save() {
    setErrorMsg('');
    const trimmed = displayName.trim();
    if (!trimmed || trimmed === me?.displayName) return;
    try {
      await update.mutateAsync({ displayName: trimmed });
      setSavedKind('success');
    } catch (e) {
      setSavedKind('error');
      setErrorMsg(e instanceof Error ? e.message : t('saveFailed'));
    }
  }

  const canSave =
    displayName.trim().length > 0 &&
    displayName.trim() !== me?.displayName &&
    !update.isPending;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('title')}</h2>

      <Section title={t('avatar')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'var(--color-brand-50)',
              color: 'var(--color-brand-500)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
              fontWeight: 700,
            }}
          >
            {(displayName || me?.displayName || t('user'))
              .slice(0, 1)
              .toUpperCase()}
          </div>
          <span style={{ fontSize: 15, fontWeight: 500 }}>
            {displayName || me?.displayName || t('user')}
          </span>
        </div>
      </Section>

      <Section title={t('basicInfo')}>
        <InfoRow label={t('userCodeLabel')}>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {me?.userCode ?? '—'}
          </span>
        </InfoRow>
        <InfoRow label={t('emailLabel')}>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {me?.email ?? '—'}
          </span>
        </InfoRow>
        <InfoRow label={t('nameLabel')}>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={isLoading || update.isPending}
            style={{
              width: 250,
              padding: '4px 8px',
              fontSize: 14,
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md, 4px)',
              background: 'var(--color-bg-surface)',
              color: 'var(--color-text-primary)',
            }}
          />
        </InfoRow>
      </Section>

      <Section title={t('security')}>
        <Button
          variant="secondary"
          onClick={() => setShowPasswordSheet(true)}
        >
          {t('changePassword')}
        </Button>
      </Section>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 12,
        }}
      >
        {savedKind === 'success' && (
          <span
            style={{ fontSize: 12, color: 'var(--color-success)' }}
          >
            {t('saved')}
          </span>
        )}
        {savedKind === 'error' && (
          <span style={{ fontSize: 12, color: 'var(--color-danger)' }}>
            {errorMsg || t('saveFailed')}
          </span>
        )}
        <Button variant="primary" onClick={save} disabled={!canSave}>
          {update.isPending ? t('saving') : t('saveChanges')}
        </Button>
      </div>

      {showPasswordSheet && (
        <ChangePasswordSheet onClose={() => setShowPasswordSheet(false)} />
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--color-text-secondary)',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
      }}
    >
      <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}
