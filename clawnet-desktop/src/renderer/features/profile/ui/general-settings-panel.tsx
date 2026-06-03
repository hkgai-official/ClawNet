// src/renderer/features/profile/ui/general-settings-panel.tsx
//
// Mirrors macOS GeneralSettingsView (SettingsView.swift:25-48) for the
// Language + About sections. P3F appends an "Updates" sub-section
// (Win-port-only, no macOS source).

import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '../../../hooks/use-i18n';
import { useIpc } from '../../../hooks/use-ipc';
import { useUpdateStatus } from '../../update/hooks/use-update-status';
import { Button } from '../../../components/ui/button';

type UpdateT = TFunction<['settings', 'update']>;

export function GeneralSettingsPanel() {
  const { t } = useTranslation(['settings', 'update']);
  const { language, setLanguage } = useLanguage();
  const { status, check, restart } = useUpdateStatus();
  const ipc = useIpc();
  // Pulls the runtime version from main (app.getVersion). Cached by react-query
  // — the version doesn't change at runtime, so staleTime is effectively
  // forever for this query.
  const about = useQuery({
    queryKey: ['app.about.get'],
    queryFn: () => ipc('app.about.get', {}),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const appVersion = about.data?.version ?? '…';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('settings:general.title')}</h2>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)' }}>
          {t('settings:general.language')}
        </h3>
        <select
          value={language}
          onChange={(e) => void setLanguage(e.target.value as 'en' | 'zh-Hans' | 'zh-Hant')}
          style={{
            padding: '6px 10px', fontSize: 14, borderRadius: 6,
            border: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg-surface)',
            color: 'var(--color-text-primary)',
            minWidth: 180,
          }}
        >
          <option value="en">English</option>
          <option value="zh-Hans">简体中文</option>
          <option value="zh-Hant">繁體中文</option>
        </select>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)' }}>
          {t('settings:about.title')}
        </h3>
        <InfoRow label={t('settings:about.version')} value={appVersion} />
        <InfoRow label={t('settings:about.app')} value={t('settings:about.appName')} />
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)' }}>
          {t('update:title')}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <UpdateButton
            status={status}
            onCheck={() => void check()}
            onRestart={() => void restart()}
            t={t}
          />
          <UpdateStatusLabel status={status} t={t} />
        </div>
      </section>
    </div>
  );
}

function UpdateButton({
  status, onCheck, onRestart, t,
}: {
  status: { state: string };
  onCheck: () => void;
  onRestart: () => void;
  t: UpdateT;
}) {
  if (status.state === 'downloaded') {
    return <Button variant="primary" onClick={onRestart}>{t('update:restart')}</Button>;
  }
  const busy = status.state === 'checking' || status.state === 'downloading';
  return (
    <Button variant="secondary" onClick={onCheck} disabled={busy}>
      {t('update:checkForUpdates')}
    </Button>
  );
}

function UpdateStatusLabel({
  status,
  t,
}: {
  status: {
    state: string;
    version?: string | undefined;
    progressPercent?: number | undefined;
    error?: string | undefined;
  };
  t: UpdateT;
}) {
  let text = '';
  switch (status.state) {
    case 'checking':
      text = t('update:checking');
      break;
    case 'no-update':
      text = t('update:upToDate');
      break;
    case 'available':
      text = t('update:available', { version: status.version ?? '?' });
      break;
    case 'downloading':
      text = t('update:downloading', {
        version: status.version ?? '?',
        percent: Math.round(status.progressPercent ?? 0),
      });
      break;
    case 'downloaded':
      text = t('update:downloaded', { version: status.version ?? '?' });
      break;
    case 'error':
      text = `${t('update:errorTitle')}: ${status.error ?? ''}`;
      break;
    case 'idle':
    default:
      text = '';
  }
  if (!text) return null;
  return (
    <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{text}</span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 14 }}>{value}</span>
    </div>
  );
}
