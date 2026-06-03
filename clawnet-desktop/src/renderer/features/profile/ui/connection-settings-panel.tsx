import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIpc } from '../../../hooks/use-ipc';
import { useConnection } from '../../../hooks/use-connection';
import { useAuth } from '../../auth/hooks/use-auth';
import { Button } from '../../../components/ui/button';
import { toastStore } from '../../../components/toast-overlay';

/**
 * 1:1 port of macOS ConnectionSettingsView (SettingsView.swift:50-122).
 * Shows the current gateway connection state + an editable server URL
 * field with an "Apply & Reconnect" action. Used by self-hosted /
 * multi-environment users who need to switch the WS gateway without
 * signing out.
 */
export function ConnectionSettingsPanel() {
  const { t } = useTranslation('settings');
  const ipc = useIpc();
  const { status, manualReconnect } = useConnection();
  const { updateServerURL } = useAuth();

  const [currentURL, setCurrentURL] = useState('');
  const [editingURL, setEditingURL] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ipc('settings.defaultServerURL.get', {}).then((url) => {
      if (cancelled) return;
      setCurrentURL(url);
      setEditingURL(url);
    });
    return () => {
      cancelled = true;
    };
  }, [ipc]);

  const trimmedEdit = editingURL.trim();
  const urlHasChanged = trimmedEdit.length > 0 && trimmedEdit !== currentURL;

  const validateURL = (s: string): string | null => {
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return t('connection.invalidURLFormat', {
          defaultValue: 'URL must start with http:// or https://',
        });
      }
      return null;
    } catch {
      return t('connection.invalidURLFormat', {
        defaultValue: 'Invalid URL format',
      });
    }
  };

  const applyNewURL = async () => {
    const v = validateURL(trimmedEdit);
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setIsApplying(true);
    try {
      await updateServerURL(trimmedEdit);
      setCurrentURL(trimmedEdit);
      // Force a reconnect against the new server.
      await manualReconnect();
      toastStore.getState().push({
        message: t('connection.reconnecting', {
          defaultValue: 'Reconnecting to new server…',
        }),
        level: 'info',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsApplying(false);
    }
  };

  const isConnected = status === 'connected';

  return (
    <section
      className="flex flex-col gap-5 p-6"
      style={{
        maxWidth: 720,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <h2 className="text-lg font-semibold m-0">
        {t('connection.title', { defaultValue: 'Gateway connection' })}
      </h2>

      {/* Status row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'var(--color-bg-surface-2)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: isConnected
              ? 'var(--color-success)'
              : status === 'reconnecting' || status === 'connecting'
                ? 'var(--color-warning)'
                : 'var(--color-danger)',
          }}
        />
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {t(`sidebar.${status}`)}
        </span>
        <span style={{ flex: 1 }} />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void manualReconnect()}
          disabled={status === 'connecting' || status === 'reconnecting'}
        >
          {t('connection.reconnectNow', { defaultValue: 'Reconnect now' })}
        </Button>
      </div>

      {/* Server URL editor */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="connection-server-url"
          style={{ fontSize: 13, fontWeight: 500 }}
        >
          {t('connection.serverAddress', { defaultValue: 'Server address' })}
        </label>
        <input
          id="connection-server-url"
          type="url"
          value={editingURL}
          onChange={(e) => setEditingURL(e.target.value)}
          disabled={isApplying}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="font-mono"
          style={{
            padding: '8px 10px',
            fontSize: 13,
            background: 'var(--color-bg-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-primary)',
          }}
        />
        {error && (
          <div
            role="alert"
            style={{ fontSize: 12, color: 'var(--color-danger)' }}
          >
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditingURL(currentURL)}
            disabled={isApplying || !urlHasChanged}
          >
            {t('connection.revert', { defaultValue: 'Revert' })}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void applyNewURL()}
            disabled={isApplying || !urlHasChanged}
          >
            {isApplying
              ? t('connection.applying', { defaultValue: 'Applying…' })
              : t('connection.applyAndReconnect', {
                  defaultValue: 'Apply & Reconnect',
                })}
          </Button>
        </div>
      </div>
    </section>
  );
}
