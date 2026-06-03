import type { FileInfo } from '../../../../shared/domain/file';

interface Props {
  file: FileInfo;
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileIconLabel(mime: string): string {
  if (mime.startsWith('image/')) return 'IMG';
  if (mime.startsWith('video/')) return 'VID';
  if (mime.startsWith('audio/')) return 'AUD';
  if (mime.includes('pdf')) return 'PDF';
  if (mime.includes('zip') || mime.includes('compressed')) return 'ZIP';
  return 'DOC';
}

/**
 * Read-only file hit. FileInfo wire payload doesn't include a reliable
 * conversationId, so we can't jump-to-message from a file hit.
 * Operator workflow: copy the file name and search
 * for it again as a message text query if a jump is needed.
 */
export function FileResultRow({ file }: Props) {
  return (
    <div
      data-testid={`search-file-${file.id}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--color-text-primary)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 32,
          height: 32,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-bg-surface-2)',
          color: 'var(--color-text-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.5,
        }}
      >
        {fileIconLabel(file.mimeType)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {file.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
          {formatSize(file.size)}
        </div>
      </div>
    </div>
  );
}
