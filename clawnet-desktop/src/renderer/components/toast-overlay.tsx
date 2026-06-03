import { create } from 'zustand';

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  id: string;
  message: string;
  level: ToastLevel;
  /** Optional bold title rendered above the message (e.g. sender name for
   *  new-message banners). When set, the toast becomes a two-line card. */
  title?: string;
  /** Optional click handler — when set, the toast renders as a button so
   *  users can jump to the related surface (e.g. "open this conversation").
   *  Click also auto-dismisses. */
  onClick?: () => void;
}

interface ToastState {
  toasts: Toast[];
  push(t: Omit<Toast, 'id'>): void;
  dismiss(id: string): void;
}

/**
 * Non-blocking transient feedback overlay. Mirrors macOS `ToastOverlay.swift`
 * — used by the file-upload pipeline to surface errors that don't merit a
 * full alert (upload failed, drag-drop not supported for non-native files,
 * etc.). Toasts auto-dismiss after 3.5s.
 */
export const toastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    }, 3500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

const COLORS: Record<ToastLevel, string> = {
  info: 'var(--color-bg-surface-2)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-danger)',
};

export function ToastOverlay() {
  const toasts = toastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => {
        const baseStyle: React.CSSProperties = {
          background: COLORS[t.level],
          color: 'var(--color-text-primary)',
          padding: '8px 12px',
          borderRadius: 'var(--radius-md)',
          fontSize: '0.875rem',
          maxWidth: 320,
          minWidth: 220,
          boxShadow: 'var(--shadow-md)',
          pointerEvents: 'auto',
          textAlign: 'left',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        };
        const body = (
          <>
            {t.title && (
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t.title}</span>
            )}
            <span style={{ fontSize: 12 }}>{t.message}</span>
          </>
        );
        if (t.onClick) {
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                t.onClick?.();
                toastStore.getState().dismiss(t.id);
              }}
              style={{ ...baseStyle, border: 'none', cursor: 'pointer' }}
            >
              {body}
            </button>
          );
        }
        return (
          <div key={t.id} role="status" style={baseStyle}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
