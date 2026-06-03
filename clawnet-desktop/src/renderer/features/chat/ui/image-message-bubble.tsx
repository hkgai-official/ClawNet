import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageLightbox } from './image-lightbox';
import { useUploadStore } from '../state/upload-slice';
import { useFileUpload } from '../hooks/use-file-upload';
import { useIpc } from '../../../hooks/use-ipc';
import type { ChatMessage } from '../../../../shared/domain/chat';

interface Props {
  message: ChatMessage;
  conversationId: string;
}

/**
 * Image thumbnail bubble (max 240×180) with click-to-open lightbox.
 * Ports macOS `ImageMessageView.swift:1-176` thumbnail variant. The fullscreen
 * viewer is delegated to `ImageLightbox`.
 *
 * URL preference: `clawnet-file://{id}` (sent/received) → `file://{localPath}`
 * (optimistic in-flight) → `content.url` → `content.thumbnailUrl` → null.
 */
function resolveImageSrc(message: ChatMessage): string | null {
  const c = message.content as { id?: string; url?: string; thumbnailUrl?: string; localPath?: string };
  if (c.id) return `clawnet-file://${c.id}`;
  if (c.localPath) return `file://${c.localPath}`;
  if (c.url) return c.url;
  if (c.thumbnailUrl) return c.thumbnailUrl;
  return null;
}

export function ImageMessageBubble({ message, conversationId }: Props) {
  const { t } = useTranslation('chat');
  const ipc = useIpc();
  const [open, setOpen] = useState(false);
  const c = message.content as {
    id?: string | null;
    url?: string | null;
    thumbnailUrl?: string | null;
    name?: string | null;
    localPath?: string | null;
    size?: number | null;
  };
  const src = resolveImageSrc(message);
  const upload = useFileUpload(conversationId);
  const startUpload = useUploadStore.getState().startUpload;
  const onRetry = () => {
    const localPath = c.localPath;
    if (!localPath) return;
    startUpload(message.id, c.size ?? 0);
    upload.mutate({ tempId: message.id, input: localPath });
  };
  const uploadProgress = useUploadStore((s) => s.uploads[message.id]);
  const isUploading = uploadProgress?.status === 'in_progress';
  const progressPct =
    uploadProgress && uploadProgress.totalBytes > 0
      ? Math.min(100, (uploadProgress.bytesSent / uploadProgress.totalBytes) * 100)
      : null;

  return (
    <>
      {/* Wrapper div provides relative positioning context so the progress
          overlay and retry button can be placed absolutely without nesting
          a <button> inside another <button> (invalid HTML). */}
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <button
          data-testid="image-bubble"
          onClick={() => setOpen(true)}
          disabled={!src || isUploading}
          aria-label={c.name ?? t('image', { defaultValue: 'Image' })}
          style={{
            padding: 0,
            border: 'none',
            background: 'none',
            cursor: src && !isUploading ? 'pointer' : 'default',
            maxWidth: 240,
            maxHeight: 180,
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            position: 'relative',
            display: 'inline-block',
          }}
        >
          {src ? (
            <img
              src={src}
              alt={c.name ?? ''}
              style={{
                maxWidth: 240,
                maxHeight: 180,
                display: 'block',
                opacity: isUploading ? 0.55 : 1,
                transition: 'opacity 120ms ease-out',
              }}
            />
          ) : (
            <div
              style={{
                width: 160,
                height: 120,
                background: 'var(--color-bg-surface-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 32,
                color: 'var(--color-text-muted)',
              }}
            >
              🖼
            </div>
          )}
          {/* Upload progress overlay (bar across the bottom). Mirrors macOS
              ProgressView in ImageMessageView's sending state. */}
          {isUploading && progressPct !== null && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: 6,
                right: 6,
                bottom: 6,
                height: 3,
                borderRadius: 2,
                background: 'var(--color-scrim)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progressPct}%`,
                  background: 'var(--color-brand-500)',
                  transition: 'width 150ms ease-out',
                }}
              />
            </div>
          )}
        </button>
        {/* Failed-retry overlay. Small absolute-positioned button in top-left
            corner when upload has failed. Sits outside the image button to
            avoid invalid <button> > <button> nesting. */}
        {uploadProgress?.status === 'failed' && (
          <button
            type="button"
            aria-label={t('retry', { defaultValue: 'Retry' })}
            onClick={(e) => { e.stopPropagation(); onRetry(); }}
            style={{
              position: 'absolute', top: 6, left: 6,
              background: 'var(--color-danger)',
              color: 'white',
              borderRadius: '50%',
              width: 24, height: 24,
              border: 'none',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ⟳
          </button>
        )}
        {/* Cancel-upload overlay. Top-right corner during in-flight upload.
            Aborts the chunk fetch in main; the existing failed-state UX
            picks up with reason='cancelled'. */}
        {isUploading && (
          <button
            type="button"
            data-testid="cancel-upload"
            aria-label={t('cancel', { defaultValue: 'Cancel' })}
            onClick={(e) => {
              e.stopPropagation();
              void ipc('chat.cancelUpload', { tempId: message.id });
            }}
            style={{
              position: 'absolute', top: 6, right: 6,
              background: 'var(--color-scrim-control)',
              color: 'white',
              borderRadius: '50%',
              width: 24, height: 24,
              border: 'none',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
        )}
      </div>
      {open && src && <ImageLightbox src={src} onClose={() => setOpen(false)} />}
    </>
  );
}
