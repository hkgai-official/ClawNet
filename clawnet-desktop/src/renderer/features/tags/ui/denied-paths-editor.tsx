// Free-form denied-paths editor used by both Create- and Edit-TagSheet.
// `deniedPaths` are absolute paths or glob patterns that should be denied
// for the tag even when they fall under `allowedPaths`. Mirrors the
// macOS `denied_paths` wire field (TagModels.swift:21); on macOS the
// per-tag editor is not exposed in the sheet (server-managed there), but
// the Win port surfaces it because the global Settings page does not yet
// have an equivalent per-tag override UI.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/ui/button';

interface Props {
  value: readonly string[];
  onChange: (next: string[]) => void;
}

export function DeniedPathsEditor({ value, onChange }: Props) {
  const { t } = useTranslation('tags');
  const [draft, setDraft] = useState('');

  function addPath() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) {
      setDraft('');
      return;
    }
    onChange([...value, trimmed]);
    setDraft('');
  }

  function removePath(path: string) {
    onChange(value.filter((p) => p !== path));
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium">{t('deniedPaths')}</label>
      <p
        className="text-xs m-0"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {t('deniedPathsHint')}
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addPath();
            }
          }}
          placeholder={t('deniedPathPlaceholder')}
          className="flex-1 px-2 py-1 text-sm"
          style={{
            background: 'var(--color-bg-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-mono)',
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={addPath}
          disabled={draft.trim().length === 0}
        >
          {t('add')}
        </Button>
      </div>
      {value.length === 0 ? (
        <p
          className="text-xs m-0"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {t('noDeniedPaths')}
        </p>
      ) : (
        <div
          className="flex flex-col gap-1 p-2 overflow-y-auto"
          style={{
            maxHeight: 144,
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {value.map((path) => (
            <div
              key={path}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span
                className="truncate flex-1"
                title={path}
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {path}
              </span>
              <button
                type="button"
                onClick={() => removePath(path)}
                aria-label={t('remove')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  padding: '2px 6px',
                  fontSize: 14,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
