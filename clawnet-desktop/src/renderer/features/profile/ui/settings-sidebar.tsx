// src/renderer/features/profile/ui/settings-sidebar.tsx
//
// Mirrors macOS SettingsSidebarPanel.swift:1-144. Vertical sidebar:
//   1. Title "Settings"
//   2. User card (clickable -> profile page) showing displayName + username/email
//   3. Page list (general / security / tags) -- profile is implicit via user card
//   4. Spacer
//   5. Connection status dot+text (4-state via useConnection)
//   6. Logout button

import { useTranslation } from 'react-i18next';
import type { ConnectionStatus } from '../../../../shared/domain/auth';
import { useAuthStore } from '../../auth/state/auth-slice';
import { useAuth } from '../../auth/hooks/use-auth';
import { useConnection } from '../../../hooks/use-connection';

export type SettingsPage = 'profile' | 'general' | 'connection' | 'security' | 'tags';

interface Props {
  active: SettingsPage;
  onSelect: (page: SettingsPage) => void;
}

const ROWS: Array<{ key: Exclude<SettingsPage, 'profile'>; icon: string }> = [
  { key: 'general', icon: '⚙' },
  { key: 'connection', icon: '🌐' },
  { key: 'security', icon: '🛡' },
  { key: 'tags', icon: '🏷' },
];

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connected: 'var(--color-success)',
  connecting: 'var(--color-info)',
  reconnecting: 'var(--color-warning)',
  disconnected: 'var(--color-danger)',
};

export function SettingsSidebar({ active, onSelect }: Props) {
  const { t } = useTranslation('settings');
  const state = useAuthStore((s) => s.state);
  const { logout } = useAuth();
  const { status } = useConnection();

  const user = state.kind === 'loggedIn' ? state.user : null;
  const isProfileActive = active === 'profile';

  return (
    <div
      style={{
        width: 240,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-surface)',
      }}
    >
      {/* Title */}
      <div style={{ padding: '16px 16px 8px 16px', fontSize: 18, fontWeight: 600 }}>
        {t('sidebar.settings')}
      </div>

      <Divider />

      {/* User card -- clickable, routes to profile page */}
      {user && (
        <button
          type="button"
          onClick={() => onSelect('profile')}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 16px',
            background: isProfileActive ? 'var(--color-brand-50)' : 'transparent',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div
            style={{
              width: 44, height: 44, borderRadius: '50%',
              background: 'var(--color-brand-50)',
              color: 'var(--color-brand-500)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {(user.displayName ?? user.username).slice(0, 1).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 14, fontWeight: 500,
                color: 'var(--color-text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {user.displayName ?? user.username}
            </div>
            <div
              style={{
                fontSize: 12, color: 'var(--color-text-secondary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {user.username}
            </div>
          </div>
        </button>
      )}

      <Divider />

      {/* Page list */}
      <div style={{ padding: '8px 8px' }}>
        {ROWS.map((row) => {
          const isActive = active === row.key;
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => onSelect(row.key)}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px',
                borderRadius: 6,
                border: 'none',
                background: isActive ? 'var(--color-brand-50)' : 'transparent',
                color: isActive ? 'var(--color-brand-500)' : 'var(--color-text-primary)',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 14,
              }}
            >
              <span style={{ width: 20, textAlign: 'center' }}>{row.icon}</span>
              <span>{t(`sidebar.${row.key}`)}</span>
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      <Divider />

      {/* Connection status (4-state) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px' }}>
        <span
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: STATUS_COLOR[status],
          }}
        />
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {t(`sidebar.${status}`)}
        </span>
      </div>

      {/* Logout */}
      <button
        type="button"
        onClick={() => logout.mutate()}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px',
          background: 'transparent',
          border: 'none',
          color: 'var(--color-danger)',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: 14,
        }}
      >
        <span style={{ width: 20, textAlign: 'center' }}>↪</span>
        <span>{t('sidebar.logout')}</span>
      </button>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--color-border-subtle)' }} />;
}
