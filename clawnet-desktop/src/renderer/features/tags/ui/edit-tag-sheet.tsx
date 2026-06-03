// src/renderer/features/tags/ui/edit-tag-sheet.tsx
//
// Edit-tag modal. For the main tag (isMain === true) the server owns
// nodeAcl (it follows the global file-access settings), so we expose
// display-name only and omit nodeAcl from the PATCH payload.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateTag } from '../hooks/use-tags';
import { useFileAccess } from '../../settings/hooks/use-file-access';
import { Button } from '../../../components/ui/button';
import { Sheet, SheetHeader, SheetBody, SheetFooter } from '../../../components/ui/sheet';
import { DeniedPathsEditor } from './denied-paths-editor';
import type { Tag } from '../../../../shared/domain/tag';

interface Props {
  tag: Tag;
  onClose: () => void;
}

export function EditTagSheet({ tag, onClose }: Props) {
  const { t } = useTranslation('tags');
  const { data: fileAccess } = useFileAccess();
  const whitelistPaths = fileAccess?.allowedPaths ?? [];
  const [displayName, setDisplayName] = useState(tag.displayName);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    new Set(tag.nodeAcl.allowedPaths),
  );
  const [deniedPaths, setDeniedPaths] = useState<string[]>(
    [...tag.nodeAcl.deniedPaths],
  );
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateTag();

  const isMain = tag.isMain === true;
  const canSubmit = displayName.trim().length > 0 && !update.isPending;

  async function submit() {
    setError(null);
    try {
      await update.mutateAsync({
        id: tag.id,
        displayName: displayName.trim(),
        // Main tag: don't touch nodeAcl — server owns it.
        ...(isMain
          ? {}
          : {
              nodeAcl: {
                allowedPaths: Array.from(selectedPaths),
                deniedPaths,
              },
            }),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorUpdate'));
    }
  }

  return (
    <Sheet open onClose={onClose} size="sm">
      <SheetHeader onClose={onClose}>{t('editTag')}</SheetHeader>
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

        {isMain ? (
          <p
            className="text-xs m-0 p-2"
            style={{
              background: 'var(--color-bg-surface-2)',
              color: 'var(--color-text-secondary)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            {t('mainTagNodeAclNote')}
          </p>
        ) : (
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
        )}

        {!isMain && (
          <DeniedPathsEditor value={deniedPaths} onChange={setDeniedPaths} />
        )}

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
          {t('save')}
        </Button>
      </SheetFooter>
    </Sheet>
  );
}
