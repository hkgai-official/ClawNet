import {
  useState,
  useRef,
  useEffect,
  type ClipboardEvent,
  type KeyboardEvent,
  type FormEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip, Smile, X } from 'lucide-react';
import { useSendMessage } from '../hooks/use-send-message';
import { useFileUpload, type UploadInput } from '../hooks/use-file-upload';
import {
  usePendingUploadsStore,
  type PendingUpload,
} from '../state/pending-uploads-slice';
import { useUploadStore } from '../state/upload-slice';
import { useIpc } from '../../../hooks/use-ipc';
import { toastStore } from '../../../components/toast-overlay';
import { Button } from '../../../components/ui/button';

// Stable empty array referenced by the pending-uploads selector when a
// conversation has no staged uploads. A fresh `[]` literal would change
// reference identity every render and trip zustand's default Object.is
// equality check → infinite re-render loop ("Maximum update depth").
const EMPTY_PENDING: readonly PendingUpload[] = [];

const QUICK_EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '🤔', '😎',
  '😢', '😭', '😡', '🙏', '👍', '👎', '👏', '🙌',
  '💪', '✨', '🔥', '🎉', '✅', '❌', '❤️', '💡',
  '👀', '🤝', '🙋', '🤷', '🚀', '⭐', '⚡', '☕',
];

const MAX_COMPOSER_HEIGHT = 200; // ≈ 8 lines @ 14px text + 1.6 line-height

const autoGrow = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
};

function genId(): string {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function Composer({ conversationId }: { conversationId: string | null }) {
  const { t } = useTranslation('chat');
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { mutate, isPending } = useSendMessage();
  const ipc = useIpc();
  const upload = useFileUpload(conversationId ?? '');
  const pending = usePendingUploadsStore(
    (s) => s.byConversation[conversationId ?? ''] ?? EMPTY_PENDING,
  );
  const addPending = usePendingUploadsStore((s) => s.add);
  const removePending = usePendingUploadsStore((s) => s.remove);
  const clearPending = usePendingUploadsStore((s) => s.clear);

  useEffect(() => {
    if (!emojiOpen) return;
    const onDown = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setEmojiOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [emojiOpen]);

  // Snap textarea back to 1-row height when text is cleared (e.g. after
  // submit). Without this, the inline height set by autoGrow would persist
  // even though there's no content to justify it.
  useEffect(() => {
    if (text === '' && textareaRef.current) {
      textareaRef.current.style.height = '36px';
    }
  }, [text]);

  if (!conversationId) return null;

  function uploadPendingItem(item: PendingUpload): UploadInput {
    if (item.kind === 'path') return item.path;
    const inp: { bytes: Uint8Array; name: string; mimeType?: string } = {
      bytes: item.bytes,
      name: item.name,
    };
    if (item.mimeType) inp.mimeType = item.mimeType;
    return inp;
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    const hasFiles = pending.length > 0;
    if (!trimmed && !hasFiles) return;
    if (isPending) return;

    // Send text first (if any) so chat order = text then attachments.
    if (trimmed) {
      mutate({ conversationId, text: trimmed }, { onSuccess: () => setText('') });
    }
    // Then drain the pending queue. Each file is uploaded independently;
    // failures surface as toasts but don't block the rest.
    if (hasFiles) {
      for (const item of pending) {
        const tempId = crypto.randomUUID();
        const input = uploadPendingItem(item);
        // Size known for bytes branch; 0 for path branch (backfilled by first progress event).
        const knownSize = typeof input !== 'string' ? input.bytes.length : 0;
        useUploadStore.getState().startUpload(tempId, knownSize);
        upload.mutate({ tempId, input }, {
          onError: (err) =>
            toastStore.getState().push({
              message: `Upload failed: ${(err as Error).message}`,
              level: 'error',
            }),
        });
      }
      clearPending(conversationId);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Guard against IME composition: CJK input methods send Enter to
    // commit a candidate; we must not submit during composition.
    // `e.nativeEvent.isComposing` is the W3C standard signal.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit(e as unknown as FormEvent);
    }
  };

  const onAttach = async () => {
    try {
      const result = await ipc('chat.pickFile', {});
      if (!result) return;
      const slash = Math.max(result.path.lastIndexOf('/'), result.path.lastIndexOf('\\'));
      const name = slash >= 0 ? result.path.slice(slash + 1) : result.path;
      addPending(conversationId, { id: genId(), kind: 'path', name, path: result.path });
    } catch (e) {
      toastStore.getState().push({
        message: `Could not open file picker: ${(e as Error).message}`,
        level: 'error',
      });
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setText((cur) => cur + emoji);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
      autoGrow(el);
    });
  };

  const insertAtCursor = (s: string) => {
    const el = textareaRef.current;
    if (!el) {
      setText((cur) => cur + s);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + s + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + s.length;
      el.setSelectionRange(pos, pos);
      autoGrow(el);
    });
  };

  const onPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of Array.from(items)) {
        if (!item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const name = file.name && file.name.length > 0
            ? file.name
            : `pasted-${Date.now()}.${item.type.split('/')[1] ?? 'png'}`;
          const blob = new Blob([new Uint8Array(bytes)], { type: item.type });
          addPending(conversationId, {
            id: genId(),
            kind: 'bytes',
            name,
            bytes,
            mimeType: item.type,
            previewURL: URL.createObjectURL(blob),
          });
        } catch (err) {
          toastStore.getState().push({
            message: `Paste failed: ${(err as Error).message}`,
            level: 'error',
          });
        }
        return;
      }
    }

    // Plain-text branch — only reached when the image loop fell through
    // (no image item on clipboard). Normalizes newlines collapsed from
    // react-markdown DOM block boundaries, mirrors Discord/Slack default.
    const raw = e.clipboardData?.getData('text/plain') ?? '';
    if (!raw) return;
    e.preventDefault();
    const normalized = raw
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
    insertAtCursor(normalized);
  };

  const submitDisabled =
    (!text.trim() && pending.length === 0) || isPending || upload.isPending;

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 p-3"
      style={{
        borderTop: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-surface)',
      }}
    >
      {/* Pending attachments strip — mirrors macOS pendingFiles + FilePreviewChip. */}
      {pending.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            paddingBottom: 4,
          }}
        >
          {pending.map((item) => (
            <PendingChip
              key={item.id}
              item={item}
              onRemove={() => removePending(conversationId, item.id)}
            />
          ))}
        </div>
      )}

      <div className="flex items-end gap-2" style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={onAttach}
          aria-label={t('attachFile', { defaultValue: 'Attach file' })}
          data-testid="attach-file-btn"
          style={{
            background: 'transparent',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-secondary)',
            width: 36,
            height: 36,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Paperclip size={16} aria-hidden />
        </button>
        <div ref={emojiRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setEmojiOpen((v) => !v)}
            aria-label={t('insertEmoji', { defaultValue: 'Insert emoji' })}
            aria-expanded={emojiOpen}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-secondary)',
              width: 36,
              height: 36,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Smile size={16} aria-hidden />
          </button>
          {emojiOpen && (
            <div
              role="dialog"
              aria-label={t('insertEmoji', { defaultValue: 'Insert emoji' })}
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 6px)',
                left: 0,
                padding: 8,
                background: 'var(--color-bg-app)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-popover, 0 4px 12px var(--color-scrim))',
                display: 'grid',
                gridTemplateColumns: 'repeat(8, 28px)',
                gap: 4,
                zIndex: 50,
              }}
            >
              {QUICK_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    insertEmoji(e);
                    setEmojiOpen(false);
                  }}
                  style={{
                    width: 28,
                    height: 28,
                    fontSize: 18,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 4,
                    lineHeight: 1,
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            autoGrow(e.target);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={t('composerPlaceholder')}
          aria-label={t('composerPlaceholder')}
          rows={1}
          className="flex-1 resize-none p-2 text-sm"
          style={{
            background: 'var(--color-bg-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text-primary)',
            minHeight: 36,
            maxHeight: MAX_COMPOSER_HEIGHT,
            overflowY: 'auto',
          }}
        />
        <Button type="submit" disabled={submitDisabled} size="md">
          {t('send')}
        </Button>
      </div>
    </form>
  );
}

function PendingChip({
  item,
  onRemove,
}: {
  item: PendingUpload;
  onRemove: () => void;
}) {
  const isImage =
    item.mimeType?.startsWith('image/') ||
    (item.kind === 'bytes' && !!item.previewURL);

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px 4px 4px',
        background: 'var(--color-bg-surface-2)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        maxWidth: 240,
      }}
    >
      {isImage && item.kind === 'bytes' && item.previewURL ? (
        <img
          src={item.previewURL}
          alt=""
          style={{
            width: 28,
            height: 28,
            objectFit: 'cover',
            borderRadius: 4,
            flexShrink: 0,
          }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            width: 28,
            height: 28,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-bg-app)',
            borderRadius: 4,
            fontSize: 14,
            color: 'var(--color-text-muted)',
            flexShrink: 0,
          }}
        >
          📎
        </span>
      )}
      <span
        className="truncate"
        style={{ fontSize: 12, maxWidth: 160 }}
        title={item.name}
      >
        {item.name}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-muted)',
          display: 'inline-flex',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <X size={12} aria-hidden />
      </button>
    </div>
  );
}
