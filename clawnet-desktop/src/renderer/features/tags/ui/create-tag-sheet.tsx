// src/renderer/features/tags/ui/create-tag-sheet.tsx
//
// Create-tag modal. The allowed-paths multi-select is drawn from the
// global file-access whitelist (settings.fileAccess.allowedPaths), since
// a tag can only ever scope DOWN from the global allowlist — it cannot
// grant a path that isn't already on the global list.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateTag } from '../hooks/use-tags';
import { useFileAccess } from '../../settings/hooks/use-file-access';
import { Button } from '../../../components/ui/button';
import { Sheet, SheetHeader, SheetBody, SheetFooter } from '../../../components/ui/sheet';
import { DeniedPathsEditor } from './denied-paths-editor';

interface Props {
  onClose: () => void;
}

export function CreateTagSheet({ onClose }: Props) {
  const { t } = useTranslation('tags');
  const { data: fileAccess } = useFileAccess();
  const whitelistPaths = fileAccess?.allowedPaths ?? [];
  const [displayName, setDisplayName] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [deniedPaths, setDeniedPaths] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateTag();

  const canSubmit = displayName.trim().length > 0 && !create.isPending;

  async function submit() {
    setError(null);
    const allowed = Array.from(selectedPaths);
    try {
      await create.mutateAsync({
        displayName: displayName.trim(),
        nodeAcl:
          allowed.length > 0 || deniedPaths.length > 0
            ? { allowedPaths: allowed, deniedPaths }
            : undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorCreate'));
    }
  }

  return (
    <Sheet open onClose={onClose} size="sm">
      <SheetHeader onClose={onClose}>{t('newTag')}</SheetHeader>
      <SheetBody>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">{t('tagName')}</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoFocus
            className="px-2 py-1 text-sm"
            style={{
              background: 'var(--color-bg-surface-2)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-primary)',
            }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">{t('allowedPaths')}</label>
          {whitelistPaths.length === 0 ? (
            <p
              className="text-xs m-0"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {t('addWhitelistFirst')}
            </p>
          ) : (
            <div
              className="overflow-y-auto p-2 flex flex-col gap-1"
              style={{
                maxHeight: 192,
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {whitelistPaths.map((path) => (
                <label
                  key={path}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedPaths.has(path)}
                    onChange={(e) => {
                      const next = new Set(selectedPaths);
                      if (e.target.checked) next.add(path);
                      else next.delete(path);
                      setSelectedPaths(next);
                    }}
                  />
                  <span
                    className="truncate text-xs"
                    title={path}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {path}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <DeniedPathsEditor value={deniedPaths} onChange={setDeniedPaths} />

        {error && (
          <p
            className="text-xs m-0"
            style={{ color: 'var(--color-danger)' }}
          >
            {error}
          </p>
        )}
      </SheetBody>
      <SheetFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          disabled={!canSubmit}
        >
          {t('create')}
        </Button>
      </SheetFooter>
    </Sheet>
  );
}
