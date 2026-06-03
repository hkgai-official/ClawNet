import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIpc } from '../../../hooks/use-ipc';
import { toastStore } from '../../../components/toast-overlay';
import { useUploadStore } from '../state/upload-slice';
import { useDownloadStore } from '../state/download-slice';
import { useFileUpload } from '../hooks/use-file-upload';
import { useFileDownloadMutation } from '../hooks/use-file-download';
import type { ChatMessage } from '../../../../shared/domain/chat';

interface FileMessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  conversationId: string;
}

function formatSize(size: number | null | undefined): string {
  if (size == null) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileIcon(mime: string | null | undefined): string {
  if (!mime) return '📄';
  if (mime.startsWith('image/')) return '🖼';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime.includes('pdf')) return '📕';
  if (mime.includes('zip') || mime.includes('tar')) return '🗜';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('sheet') || mime.includes('excel')) return '📊';
  return '📄';
}

/** Minimal SVG ring used while an upload is in flight. Sized for the bubble's
 *  side icon slot (matches the existing 18px button glyph). The arc length is
 *  driven by `pct` (0–100); when totalBytes isn't yet known a quarter-arc is
 *  rendered as an indeterminate indicator. */
function UploadRing({ pct }: { pct: number | null }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const dash = pct == null ? c * 0.25 : (pct / 100) * c;
  return (
    <svg
      data-testid="upload-progress"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      aria-hidden
      style={{ display: 'block' }}
    >
      <circle
        cx={12}
        cy={12}
        r={r}
        fill="none"
        stroke="var(--color-scrim)"
        strokeWidth={2}
      />
      <circle
        cx={12}
        cy={12}
        r={r}
        fill="none"
        stroke="var(--color-brand-500)"
        strokeWidth={2}
        strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

/**
 * Renders a file attachment card with icon, name, size, and action buttons.
 * Mirrors macOS `FileMessageView.swift:1-93`.
 *
 * Three action surfaces:
 *  - Upload in progress  → ring progress overlay (`upload-progress` testid).
 *  - Upload failed       → Retry button (re-fires `chat.sendFile` for the
 *                          same tempId via `useFileUpload`).
 *  - Sent / received     → Open button (materializes via
 *                          `chat.fetchFileForOpen` then `shell.openPath`)
 *                          and the legacy Download (Save-As) button.
 */
export function FileMessageBubble({ message, isOwn, conversationId }: FileMessageBubbleProps) {
  const { t } = useTranslation('chat');
  const ipc = useIpc();
  const [downloading, setDownloading] = useState(false);
  const [opening, setOpening] = useState(false);
  const uploadProgress = useUploadStore((s) => s.uploads[message.id]);
  const startUpload = useUploadStore((s) => s.startUpload);
  const downloadEntry = useDownloadStore((s) => s.downloads[message.id]);
  const upload = useFileUpload(conversationId);
  const download = useFileDownloadMutation();
  const c = message.content as {
    id?: string | null;
    name?: string | null;
    size?: number | null;
    mimeType?: string | null;
    localPath?: string | null;
  };

  const isUploading = uploadProgress?.status === 'in_progress';
  const uploadFailed = uploadProgress?.status === 'failed';
  const uploadPct =
    uploadProgress && uploadProgress.totalBytes > 0
      ? Math.min(100, (uploadProgress.bytesSent / uploadProgress.totalBytes) * 100)
      : null;

  const onRetry = () => {
    const localPath = c.localPath;
    if (!localPath) return;
    startUpload(message.id, c.size ?? 0);
    upload.mutate({ tempId: message.id, input: localPath });
  };

  const onOpen = async () => {
    if (!c.id && !downloadEntry?.localPath) return;
    setOpening(true);
    try {
      const result = downloadEntry?.localPath
        ? { localPath: downloadEntry.localPath }
        : await download.mutateAsync({ messageId: message.id, fileId: c.id! });
      const shellResult = await ipc('shell.openPath', { path: result.localPath });
      if (!shellResult.ok) {
        toastStore.getState().push({
          message: `Open failed: ${shellResult.error ?? 'unknown error'}`,
          level: 'error',
        });
      }
    } catch (e) {
      toastStore.getState().push({
        message: `Open failed: ${(e as Error).message}`,
        level: 'error',
      });
    } finally {
      setOpening(false);
    }
  };

  const onDownload = async () => {
    if (!c.id) return;
    setDownloading(true);
    try {
      const result = await ipc('chat.downloadFile', {
        fileId: c.id,
        suggestedName: c.name ?? 'download',
      });
      // Toast doubles as a Reveal-in-folder affordance — click anywhere on
      // the toast and the OS file explorer pops to the saved file.
      // Mirrors macOS NSWorkspace.selectFile UX.
      toastStore.getState().push({
        message: `Saved to ${result.savedPath} — click to reveal`,
        level: 'success',
        onClick: () => {
          void ipc('shell.showItemInFolder', { path: result.savedPath });
        },
      });
    } catch (e) {
      toastStore.getState().push({
        message: `Download failed: ${(e as Error).message}`,
        level: 'error',
      });
    } finally {
      setDownloading(false);
    }
  };

  const status = message.status ?? 'sent';
  // Show the Open + Download buttons whenever the server confirms a file id
  // exists (i.e. not while uploading and not while the upload failed).
  const isSettled = !isUploading && !uploadFailed && Boolean(c.id);
  // Open is only meaningful for received messages — senders already have the
  // file locally and don't need to re-fetch it from the server.
  const showOpenButton = isSettled && !isOwn;

  return (
    <div
      data-testid="file-bubble"
      style={{
        width: 240,
        padding: 10,
        background: isOwn ? 'var(--color-brand-50)' : 'var(--color-bg-surface-2)',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span style={{ fontSize: 24 }}>{fileIcon(c.mimeType ?? null)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 13,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--color-text-primary)',
          }}
        >
          {c.name ?? 'unnamed file'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
          {status === 'sending' &&
            (uploadProgress
              ? `Uploading ${formatSize(uploadProgress.bytesSent)} / ${formatSize(uploadProgress.totalBytes)}`
              : 'Uploading…')}
          {(status === 'failed' || uploadFailed) && 'Upload failed'}
          {(status === 'sent' || status === 'read') && formatSize(c.size ?? null)}
        </div>
      </div>
      {isUploading && (
        <>
          <UploadRing pct={uploadPct} />
          <button
            type="button"
            data-testid="cancel-upload"
            aria-label={t('cancel', { defaultValue: 'Cancel' })}
            onClick={(e) => {
              e.stopPropagation();
              void ipc('chat.cancelUpload', { tempId: message.id });
            }}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: 14,
              padding: 2,
            }}
          >
            ✕
          </button>
        </>
      )}
      {uploadFailed && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={t('retry', { defaultValue: 'Retry' })}
          style={{
            background: 'var(--color-danger)',
            color: 'white',
            border: 'none',
            borderRadius: '50%',
            width: 24,
            height: 24,
            cursor: 'pointer',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ⟳
        </button>
      )}
      {showOpenButton && (
        <button
          type="button"
          onClick={onOpen}
          disabled={opening}
          aria-label={t('open', { defaultValue: 'Open' })}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: opening ? 'not-allowed' : 'pointer',
            fontSize: 18,
            color: 'var(--color-text-secondary)',
          }}
        >
          {opening ? '⏳' : '↗'}
        </button>
      )}
      {isSettled && (
        <button
          onClick={onDownload}
          disabled={downloading}
          aria-label={t('download', { defaultValue: 'Download' })}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: downloading ? 'not-allowed' : 'pointer',
            fontSize: 18,
            color: 'var(--color-text-secondary)',
          }}
        >
          {downloading ? '⏳' : '⬇'}
        </button>
      )}
    </div>
  );
}
