// src/renderer/components/ui/sheet.tsx
//
// Shared modal/sheet primitive. Replaces the per-feature inline-style
// overlays (new-chat-modal, new-group-modal, create-tag-sheet, …) that
// each re-implemented portal + scrim + close-on-overlay-click.
//
// Design — matches Linear:
//   - Two size tokens: sm (480px) / md (640px), both capped by
//     `min(<size>, calc(100vw - 32px))` so narrow windows don't clip.
//   - Three-segment layout: Header / Body / Footer; Body owns the scroll
//     so Header + Footer stay pinned.
//   - 150 ms fade + 8 px slide-up entrance, mirrored on close.
//   - ESC closes; clicking the scrim closes; clicking inside doesn't.
//   - First focusable element receives focus on open; previous focus is
//     restored on close. Tab navigation is trapped within the sheet.
//   - Portal target is `document.body` so the sheet escapes any clipped
//     ancestor (sidebar overflow, chat container scroll, etc.).
//
// Usage:
//   <Sheet open={open} onClose={close} size="sm" testId="new-chat-modal">
//     <SheetHeader>{t('newChat.title')}</SheetHeader>
//     <SheetBody>...</SheetBody>
//     <SheetFooter>
//       <Button variant="ghost" onClick={close}>{t('cancel')}</Button>
//       <Button onClick={submit}>{t('save')}</Button>
//     </SheetFooter>
//   </Sheet>

import {
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type SheetSize = 'sm' | 'md';

const SIZE_PX: Record<SheetSize, number> = {
  sm: 480,
  md: 640,
};

export interface SheetProps {
  /** Mount/unmount controller. When false the sheet is unmounted (no
   *  hidden DOM left behind). */
  open: boolean;
  /** Called when the user dismisses via ESC, scrim click, or programmatic
   *  close. Always close the sheet from the parent in response. */
  onClose: () => void;
  /** Width tier. sm=480, md=640 (Linear scheme). Both apply the
   *  responsive cap `min(<size>, calc(100vw - 32px))`. */
  size?: SheetSize;
  /** When false, clicking on the scrim background does NOT close the
   *  sheet — used for sheets where data loss is significant (mid-wizard).
   *  ESC still works. Default: true. */
  closeOnScrim?: boolean;
  /** Test id forwarded to the sheet root for Playwright selectors. */
  testId?: string;
  /** Override the maxHeight of the entire sheet (Header+Body+Footer).
   *  Default '85vh' keeps a 7.5vh margin top/bottom. */
  maxHeight?: string;
  children: ReactNode;
}

const KEYFRAMES = `
@keyframes clawnet-sheet-overlay-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes clawnet-sheet-content-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;

function installKeyframesOnce(): void {
  if (typeof document === 'undefined') return;
  const id = 'clawnet-sheet-keyframes';
  if (document.getElementById(id)) return;
  const el = document.createElement('style');
  el.id = id;
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({
  open,
  onClose,
  size = 'sm',
  closeOnScrim = true,
  testId,
  maxHeight = '85vh',
  children,
}: SheetProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  // One-time keyframe injection on first mount. Cheaper than per-instance
  // <style> tags and survives unmount/remount.
  useEffect(() => {
    installKeyframesOnce();
  }, []);

  // ESC + focus management. Effect runs only while `open` is true so the
  // listener is automatically detached on close.
  useEffect(() => {
    if (!open) return;
    lastFocusRef.current = document.activeElement as HTMLElement | null;

    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);

    // Auto-focus the first focusable element inside the sheet on next
    // tick — earlier than rAF would put us before React paints children.
    const t = setTimeout(() => {
      const el = contentRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      el?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
      // Restore focus to whatever was focused before the sheet opened.
      // Guard against the element being gone (rare; happens if the parent
      // re-rendered into a different tree).
      const prev = lastFocusRef.current;
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  // Tab trap: when Tab/Shift+Tab hits the boundary, wrap to the other
  // end. Implemented at the sheet root so individual children don't
  // need awareness.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const root = contentRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const widthPx = SIZE_PX[size];
  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'var(--color-scrim)',
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'clawnet-sheet-overlay-in 150ms ease-out',
  };
  const contentStyle: CSSProperties = {
    background: 'var(--color-bg-surface)',
    border: '1px solid var(--color-border-subtle)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-lg)',
    width: `min(${widthPx}px, calc(100vw - 32px))`,
    maxHeight,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    animation: 'clawnet-sheet-content-in 150ms ease-out',
  };

  return createPortal(
    <div
      onClick={closeOnScrim ? onClose : undefined}
      onKeyDown={onKeyDown}
      style={overlayStyle}
    >
      <div
        ref={contentRef}
        onClick={(e) => e.stopPropagation()}
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        style={contentStyle}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Header slot — title row with optional close button. The close button
 *  is omitted by default; pass `onClose` to render an X. */
export function SheetHeader({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '14px 20px',
        borderBottom: '1px solid var(--color-border-subtle)',
        flexShrink: 0,
      }}
    >
      <h3
        style={{
          flex: 1,
          fontSize: 15,
          fontWeight: 600,
          margin: 0,
          color: 'var(--color-text-primary)',
        }}
      >
        {children}
      </h3>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            border: 'none',
            background: 'transparent',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            fontSize: 16,
            borderRadius: 'var(--radius-sm)',
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** Scrollable body slot. Owns the only overflow region so header/footer
 *  stay pinned even when content is long. */
export function SheetBody({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Footer slot — typically holds Cancel + primary action buttons. */
export function SheetFooter({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 8,
        padding: '12px 20px',
        borderTop: '1px solid var(--color-border-subtle)',
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}
