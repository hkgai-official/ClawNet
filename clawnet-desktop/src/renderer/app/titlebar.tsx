import type React from 'react';
import { MessagesSquare } from 'lucide-react';
import { useAuthStore } from '../features/auth/state/auth-slice';
import { StatusPill } from '../features/auth/ui/status-pill';

// macOS traffic-light buttons sit at top-left ~10px from edge; full width
// of the cluster is ~72px. We pad the titlebar so app content doesn't
// overlap them. Other platforms don't need the offset.
const MACOS_TRAFFIC_LIGHT_INSET = 78;
// Windows / Linux: window overlay buttons sit top-RIGHT (height 36px,
// see window.ts titleBarOverlay). Leave a matching right padding so the
// title bar content doesn't slide under the close button.
const WINDOWS_OVERLAY_RESERVE = 140;
const IS_DARWIN =
  typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

export function TitleBar(): React.ReactElement {
  const state = useAuthStore((s) => s.state);
  const user = state.kind === 'loggedIn' ? state.user : null;

  return (
    <header
      className="flex items-center select-none"
      style={{
        height: 'var(--titlebar-height)',
        background: 'var(--color-bg-app)',
        borderBottom: '1px solid var(--color-border-subtle)',
        paddingLeft: IS_DARWIN ? MACOS_TRAFFIC_LIGHT_INSET : 16,
        paddingRight: IS_DARWIN ? 16 : WINDOWS_OVERLAY_RESERVE,
        gap: 8,
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          color: 'var(--color-brand-500)',
          flexShrink: 0,
        }}
      >
        <MessagesSquare size={16} aria-hidden />
      </span>
      <div
        className="text-sm font-semibold"
        style={{ color: 'var(--color-text-primary)' }}
      >
        ClawNet
      </div>
      <div
        style={{ flex: 1, WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      {user && (
        <div
          className="flex items-center gap-2 text-xs"
          style={{
            WebkitAppRegion: 'no-drag',
            color: 'var(--color-text-secondary)',
          } as React.CSSProperties}
        >
          <span>{user.displayName ?? user.username}</span>
          <StatusPill />
        </div>
      )}
    </header>
  );
}
