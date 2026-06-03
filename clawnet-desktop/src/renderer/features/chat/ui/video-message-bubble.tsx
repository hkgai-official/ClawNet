import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useUploadStore } from '../state/upload-slice';
import type { ChatMessage } from '../../../../shared/domain/chat';

interface Props {
  message: ChatMessage;
}

// Mirrors resolveImageSrc in image-message-bubble.tsx — the `<video>` element
// has the same Bearer-auth problem as `<img>` and needs the same protocol
// bridge to fetch authenticated server files.
function resolveVideoSrc(message: ChatMessage): string | null {
  const c = message.content as { id?: string; url?: string; localPath?: string };
  if (c.id) return `clawnet-file://${c.id}`;
  if (c.localPath) return `file://${c.localPath}`;
  if (c.url) return c.url;
  return null;
}

/**
 * Video thumbnail bubble with center play overlay → modal HTML5 `<video>`
 * player. Ports macOS `VideoMessageView.swift:1-94`. The video src goes
 * through the `clawnet-file://` protocol bridge so authenticated server
 * files load; thumbnail still uses `c.thumbnailUrl` (no server-side
 * thumbnail file id exposed) and may not render for authenticated thumbs —
 * the play overlay remains visible regardless.
 */
export function VideoMessageBubble({ message }: Props) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const c = message.content as {
    thumbnailUrl?: string | null;
    name?: string | null;
  };
  const thumb = c.thumbnailUrl ?? null;
  const url = resolveVideoSrc(message);
  const uploadProgress = useUploadStore((s) => s.uploads[message.id]);
  const isUploading = uploadProgress?.status === 'in_progress';
  const progressPct =
    uploadProgress && uploadProgress.totalBytes > 0
      ? Math.min(100, (uploadProgress.bytesSent / uploadProgress.totalBytes) * 100)
      : null;

  return (
    <>
      <button
        data-testid="video-bubble"
        onClick={() => setOpen(true)}
        disabled={!url || isUploading}
        aria-label={c.name ?? t('video', { defaultValue: 'Video' })}
        style={{
          position: 'relative',
          padding: 0,
          border: 'none',
          background: 'none',
          cursor: url ? 'pointer' : 'default',
          maxWidth: 240,
          maxHeight: 180,
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            style={{ maxWidth: 240, maxHeight: 180, display: 'block' }}
          />
        ) : (
          <div
            style={{
              width: 200,
              height: 140,
              background: 'var(--color-bg-surface-2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 32,
              color: 'var(--color-text-muted)',
            }}
          >
            🎬
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'var(--color-scrim)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: 18,
              paddingLeft: 4,
            }}
          >
            ▶
          </div>
        </div>
        {/* Upload progress overlay — mirrors macOS VideoMessageView. */}
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

      {open &&
        url &&
        createPortal(
          <div
            role="dialog"
            aria-label="Video player"
            onClick={() => setOpen(false)}
            data-testid="video-player-modal"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'var(--color-scrim)',
              zIndex: 10000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <video
              src={url}
              controls
              autoPlay
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: '90vw', maxHeight: '85vh' }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
