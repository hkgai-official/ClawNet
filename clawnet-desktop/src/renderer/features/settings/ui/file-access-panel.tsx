import { useState, useEffect, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useFileAccess, useFileAccessUpdate } from '../hooks/use-file-access';
import { Button } from '../../../components/ui/button';
import { useIpc } from '../../../hooks/use-ipc';

/**
 * File-access policy editor. Mirrors macOS SecuritySettingsView.fileAccessSection
 * (SettingsView.swift:139-221):
 *
 *   - Segmented-control mode picker (Deny / Scoped / Full Access)
 *   - Allowed-paths editor (visible only when mode === 'scoped'; macOS
 *     gates this behind the same condition)
 *   - Denied-paths list ALWAYS visible (macOS shows it under every mode
 *     because deny rules apply on top of every other mode). Default
 *     server-emitted entries get a [default] badge and are non-removable,
 *     matching macOS's CommandPolicy.defaultDeniedPaths convention.
 *
 *   Win extension over macOS: users can also add custom denied paths.
 */
function placeholderForPlatform(): string {
  const platform = window.clawnet.platform;
  if (platform === 'win32') return 'C:\\Users\\Name\\Documents';
  if (platform === 'darwin') return '/Users/name/Documents';
  return '/home/name/Documents';
}

export function FileAccessPanel() {
  const { t } = useTranslation('settings');
  const { data } = useFileAccess();
  const update = useFileAccessUpdate();
  const ipc = useIpc();
  const [mode, setMode] = useState<'deny' | 'scoped' | 'full'>('scoped');
  const [allowedPaths, setAllowedPaths] = useState<string[]>([]);
  const [deniedPaths, setDeniedPaths] = useState<string[]>([]);
  const [newAllowedPath, setNewAllowedPath] = useState('');
  const [newDeniedPath, setNewDeniedPath] = useState('');

  useEffect(() => {
    if (data) {
      setMode(data.mode);
      setAllowedPaths(data.allowedPaths);
      setDeniedPaths(data.deniedPaths);
    }
  }, [data]);

  if (!data) return null;

  const defaultDeniedPaths = new Set(data.defaultDeniedPaths);

  const onBrowseAllowed = async () => {
    const picked = await ipc('settings.fileAccess.browsePath', {});
    if (picked) setNewAllowedPath(picked);
  };

  const onAddAllowed = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newAllowedPath.trim();
    if (!trimmed) return;
    setAllowedPaths([...allowedPaths, trimmed]);
    setNewAllowedPath('');
  };

  const onAddDenied = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newDeniedPath.trim();
    if (!trimmed) return;
    setDeniedPaths([...deniedPaths, trimmed]);
    setNewDeniedPath('');
  };

  // Layout aligned with GeneralSettingsPanel: no outer card, just a
  // flex column of sections separated by gap. The right-side panel
  // already provides padding 32 and the sidebar gives a visual frame —
  // adding a card here would be redundant and waste horizontal space.
  return (
    <section
      style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 720 }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{t('fileAccess.title')}</h2>

      {/* Mode picker — visually a single segmented control */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">{t('fileAccess.mode')}</label>
        <div
          role="group"
          aria-label={t('fileAccess.mode')}
          style={{
            display: 'inline-flex',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            width: 'fit-content',
          }}
        >
          {(['deny', 'scoped', 'full'] as const).map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                background:
                  mode === m ? 'var(--color-brand-500)' : 'var(--color-bg-surface-2)',
                color:
                  mode === m
                    ? 'var(--color-on-status)'
                    : 'var(--color-text-primary)',
                border: 'none',
                borderLeft: i === 0 ? 'none' : '1px solid var(--color-border-subtle)',
                cursor: 'pointer',
                fontWeight: mode === m ? 600 : 400,
                transition: 'background 0.15s',
              }}
            >
              {t(`fileAccess.mode${m.charAt(0).toUpperCase()}${m.slice(1)}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Allowed paths — only when scoped (mirrors macOS conditional) */}
      {mode === 'scoped' && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">{t('fileAccess.allowedPaths')}</label>
          {allowedPaths.length === 0 ? (
            <p
              className="text-xs"
              style={{ color: 'var(--color-text-muted)', margin: 0 }}
            >
              {t('fileAccess.noFoldersAuthorized', {
                defaultValue: 'No folders authorized yet.',
              })}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {allowedPaths.map((p, i) => (
                <li key={`allow-${p}-${i}`} className="flex items-center gap-2">
                  <code
                    className="flex-1 text-xs p-2 truncate"
                    style={{
                      background: 'var(--color-bg-surface-2)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {p}
                  </code>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setAllowedPaths(allowedPaths.filter((_, j) => j !== i))
                    }
                  >
                    {t('fileAccess.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={onAddAllowed} className="flex gap-2">
            <input
              value={newAllowedPath}
              onChange={(e) => setNewAllowedPath(e.target.value)}
              placeholder={placeholderForPlatform()}
              className="flex-1 px-2 py-1 text-sm"
              style={{
                background: 'var(--color-bg-surface-2)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-primary)',
              }}
            />
            <Button type="button" size="sm" variant="ghost" onClick={() => void onBrowseAllowed()}>
              {t('fileAccess.browse', { defaultValue: 'Browse...' })}
            </Button>
            <Button type="submit" size="sm" variant="secondary" disabled={!newAllowedPath.trim()}>
              {t('fileAccess.addPath')}
            </Button>
          </form>
        </div>
      )}

      {/* Denied paths — always visible (macOS: deny rules apply regardless of mode) */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">{t('fileAccess.deniedPaths')}</label>
        {deniedPaths.length === 0 ? (
          <p
            className="text-xs"
            style={{ color: 'var(--color-text-muted)', margin: 0 }}
          >
            {t('fileAccess.noDeniedPaths', {
              defaultValue: 'No denied paths configured.',
            })}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {deniedPaths.map((p, i) => {
              const isDefault = defaultDeniedPaths.has(p);
              return (
                <li key={`deny-${p}-${i}`} className="flex items-center gap-2">
                  <code
                    className="flex-1 text-xs p-2 truncate"
                    style={{
                      background: 'var(--color-bg-surface-2)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {p}
                  </code>
                  {isDefault && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'var(--color-bg-surface-2)',
                        color: 'var(--color-text-muted)',
                        textTransform: 'uppercase',
                      }}
                    >
                      {t('fileAccess.defaultLabel', { defaultValue: 'default' })}
                    </span>
                  )}
                  {!isDefault && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDeniedPaths(deniedPaths.filter((_, j) => j !== i))
                      }
                    >
                      {t('fileAccess.remove')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <form onSubmit={onAddDenied} className="flex gap-2">
          <input
            value={newDeniedPath}
            onChange={(e) => setNewDeniedPath(e.target.value)}
            placeholder={placeholderForPlatform()}
            className="flex-1 px-2 py-1 text-sm"
            style={{
              background: 'var(--color-bg-surface-2)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-primary)',
            }}
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!newDeniedPath.trim()}>
            {t('fileAccess.addPath')}
          </Button>
        </form>
      </div>

      <Button
        variant="primary"
        size="sm"
        disabled={update.isPending}
        onClick={() => update.mutate({ mode, allowedPaths, deniedPaths })}
      >
        {t('fileAccess.save')}
      </Button>
    </section>
  );
}
