// src/renderer/features/tags/ui/tag-management-panel.tsx
//
// Tag list + create/edit entry point. Mirrors macOS TagManagementView.swift.
// Main tag (isMain === true) follows global file-access settings — its
// nodeAcl is server-owned and not editable here. The default tag is not
// deletable. All other tags can be edited and deleted.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTags, useDeleteTag } from '../hooks/use-tags';
import { useTagsUiStore } from '../state/tags-slice';
import { CreateTagSheet } from './create-tag-sheet';
import { EditTagSheet } from './edit-tag-sheet';
import { Button } from '../../../components/ui/button';

export function TagManagementPanel() {
  const [confirmDeleteTagId, setConfirmDeleteTagId] = useState<string | null>(null);
  const { t } = useTranslation('tags');
  const { data: tags = [], isLoading } = useTags();
  const del = useDeleteTag();
  const { sheet, openCreate, openEdit, close } = useTagsUiStore();

  // Layout aligned with GeneralSettingsPanel: no outer card. See
  // file-access-panel for the rationale.
  return (
    <section
      style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{t('title')}</h2>

      <div
        style={{
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        {isLoading && (
          <div
            className="p-3 text-sm"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            …
          </div>
        )}
        {!isLoading && tags.length === 0 && (
          <div
            className="p-3 text-sm"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {t('noPathsConfigured')}
          </div>
        )}
        {tags.map((tag, i) => {
          const showEdit = tag.isMain !== true;
          const showDelete = !tag.isDefault && tag.isMain !== true;
          const allowed = tag.nodeAcl.allowedPaths;
          const isLast = i === tags.length - 1;
          return (
            <div
              key={tag.id}
              className="flex items-center justify-between gap-3 p-3"
              style={{
                borderBottom: isLast ? 'none' : '1px solid var(--color-border-subtle)',
              }}
            >
              <div className="min-w-0 flex-1 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{tag.displayName}</span>
                  {tag.isDefault && (
                    <span
                      className="text-xs px-1.5 py-0.5"
                      style={{
                        background: 'var(--color-bg-surface-2)',
                        color: 'var(--color-text-secondary)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      {t('defaultBadge')}
                    </span>
                  )}
                </div>
                {tag.isMain === true ? (
                  <p
                    className="text-xs m-0"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {t('tagFollowsGlobal')}
                  </p>
                ) : allowed.length > 0 ? (
                  <p
                    className="text-xs m-0 truncate"
                    title={allowed.join(', ')}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {allowed.join(', ')}
                  </p>
                ) : (
                  <p
                    className="text-xs m-0"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {t('noPathsConfigured')}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2 items-center">
                {showEdit && (
                  <Button variant="ghost" size="sm" onClick={() => openEdit(tag)}>
                    {t('editTag')}
                  </Button>
                )}
                {showDelete && confirmDeleteTagId === tag.id ? (
                  <>
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {t('confirmDelete', { name: tag.displayName })}
                    </span>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={del.isPending}
                      onClick={() => {
                        del.mutate(tag.id, {
                          onSettled: () => setConfirmDeleteTagId(null),
                        });
                      }}
                      style={{ background: 'var(--color-danger)' } as React.CSSProperties}
                    >
                      {t('deleteTag')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDeleteTagId(null)}
                    >
                      {t('cancel', { defaultValue: 'Cancel' })}
                    </Button>
                  </>
                ) : showDelete ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDeleteTagId(tag.id)}
                  >
                    {t('deleteTag')}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <Button variant="primary" size="sm" onClick={openCreate}>
          {t('newTag')}
        </Button>
      </div>

      {sheet.kind === 'create' && <CreateTagSheet onClose={close} />}
      {sheet.kind === 'edit' && <EditTagSheet tag={sheet.tag} onClose={close} />}
    </section>
  );
}
