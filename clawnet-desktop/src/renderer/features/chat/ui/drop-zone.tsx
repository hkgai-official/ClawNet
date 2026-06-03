import { useState, type ReactNode, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { UploadCloud } from 'lucide-react';
import { usePendingUploadsStore } from '../state/pending-uploads-slice';
import { toastStore } from '../../../components/toast-overlay';

interface DropZoneProps {
  conversationId: string;
  children: ReactNode;
}

/**
 * Wrap the message-list region with a drag-and-drop file overlay.
 * Dropped native files are pushed into the Composer's pending-upload
 * queue (not immediately uploaded), mirroring the macOS behavior of
 * accumulating attachments and sending them as a batch. Browser
 * blobs / DataURLs (e.g. dragged from a webpage) are rejected with a
 * warning toast — Electron only exposes a real `path` on native files.
 */
export function DropZone({ conversationId, children }: DropZoneProps) {
  const { t } = useTranslation('chat');
  const [over, setOver] = useState(false);
  const addPending = usePendingUploadsStore((s) => s.add);

  const onDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    let rejected = 0;
    // Electron 32+: `file.path` was removed. The preload exposes
    // `webUtils.getPathForFile`, which returns '' for non-filesystem
    // sources (browser blobs, dragged from a webpage).
    const resolvePath = window.clawnet?.getPathForFile;
    for (const file of files) {
      const path = resolvePath ? resolvePath(file) : '';
      if (!path) {
        rejected++;
        continue;
      }
      const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
      const name = slash >= 0 ? path.slice(slash + 1) : path;
      addPending(conversationId, {
        id: `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'path',
        name,
        path,
        ...(file.type ? { mimeType: file.type } : {}),
      });
    }
    if (rejected > 0) {
      toastStore.getState().push({
        message: t('dropRejected', {
          count: rejected,
          defaultValue:
            '{{count}} item(s) were rejected — drag-and-drop only works with native files.',
        }),
        level: 'warning',
      });
    }
  };

  return (
    <div
      data-testid="drop-zone"
      style={{
        // `flex: 1 1 0` + `minHeight: 0` so this participates in the chat
        // `<section class="flex-1 flex flex-col">` properly: takes the space
        // remaining after StatusBar instead of an unbounded `height: 100%`
        // that ignored the sibling's height and pushed the Composer
        // off-screen during long messages / streaming.
        position: 'relative',
        flex: '1 1 0',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        outline: over ? '2px dashed var(--color-brand-500)' : '2px dashed transparent',
        outlineOffset: -4,
        transition: 'outline-color 150ms ease-out',
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {children}
      {over && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background:
              'color-mix(in srgb, var(--color-brand-500) 6%, transparent)',
            borderRadius: 'var(--radius-md)',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              padding: 16,
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-brand-500)',
              borderRadius: 'var(--radius-lg)',
              color: 'var(--color-brand-500)',
            }}
          >
            <UploadCloud size={28} aria-hidden />
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {t('dropHere', { defaultValue: 'Drop files here' })}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
