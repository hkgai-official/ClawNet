// src/renderer/features/chat/ui/status-bar.tsx
//
// 1:1 port of macOS StatusBarView.swift:1-98. In-window status banner that
// appears above the chat content when:
//   - connection is not 'connected', OR
//   - a stream is in flight
// Otherwise hidden entirely (zero-noise rule, StatusBarView.swift:11-13).

import { useTranslation } from 'react-i18next';
import { AlertTriangle, Square } from 'lucide-react';
import { useConnection } from '../../../hooks/use-connection';
import { useIsStreaming } from '../hooks/use-is-streaming';
import { useIpc } from '../../../hooks/use-ipc';
import { useStreamingStore } from '../state/streaming-slice';

const DOT_COLOR: Record<'connected' | 'connecting' | 'reconnecting' | 'disconnected', string> = {
  connected: 'var(--color-success)',
  connecting: 'var(--color-warning)',
  reconnecting: 'var(--color-warning)',
  disconnected: 'var(--color-danger)',
};

export function StatusBar() {
  const { t } = useTranslation('status-bar');
  const { status, lastError, reconnectAttempt, manualReconnect } = useConnection();
  const isStreaming = useIsStreaming();
  const ipc = useIpc();
  // Pick any active streaming entry — cancelling it propagates to the
  // server via chat.stream.cancel (conversation-scoped envelope) and to
  // the local playback engine (message-scoped). Selectors must return
  // primitives so zustand's default `Object.is` equality doesn't fire a
  // re-render every tick (a `{messageId, conversationId}` object would
  // be fresh each call and trigger an infinite update loop).
  const firstActiveMessageId = useStreamingStore((s) => {
    const ids = Object.keys(s.byId);
    return ids.length > 0 ? (ids[0] ?? null) : null;
  });
  const firstActiveConversationId = useStreamingStore((s) =>
    firstActiveMessageId ? (s.byId[firstActiveMessageId]?.conversationId ?? null) : null,
  );
  const needsManualReconnect = status === 'disconnected' && reconnectAttempt > 0;

  if (status === 'connected' && !isStreaming) return null;

  const hasError = status === 'disconnected' && !!lastError && lastError.length > 0;
  const statusLabel =
    status === 'disconnected'
      ? (needsManualReconnect ? 'disconnectedLost' : 'disconnected')
      : status;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {hasError && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 16px',
            background: 'var(--color-warning-bg-subtle)',
          }}
        >
          <AlertTriangle
            aria-hidden
            size={14}
            style={{ color: 'var(--color-warning)', flexShrink: 0 }}
          />
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            {t('gatewayUnreachable')}: {lastError}
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => { void manualReconnect(); }}
            style={{
              fontSize: 11, padding: '2px 10px',
              color: 'var(--color-on-status)',
              background: 'var(--color-warning)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            {t('retry')}
          </button>
        </div>
      )}

      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 16px',
          background: 'var(--color-bg-surface)',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: DOT_COLOR[status],
          }}
        />
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{t(statusLabel)}</span>

        {needsManualReconnect && !hasError && (
          <button
            type="button"
            onClick={() => { void manualReconnect(); }}
            style={{
              fontSize: 12, padding: 0, border: 'none', background: 'transparent',
              color: 'var(--color-brand-500)', cursor: 'pointer',
            }}
          >
            {t('reconnect')}
          </button>
        )}

        {isStreaming && (
          <>
            <span
              aria-hidden
              style={{
                width: 10, height: 10,
                border: '2px solid var(--color-brand-500)',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--color-brand-500)' }}>
              {t('generating')}
            </span>
            <span style={{ flex: 1 }} />
            {firstActiveMessageId && firstActiveConversationId && (
              <button
                type="button"
                onClick={() => {
                  void ipc('chat.stream.cancel', {
                    messageId: firstActiveMessageId,
                    conversationId: firstActiveConversationId,
                  });
                }}
                aria-label={t('stop', { defaultValue: 'Stop generation' })}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                  padding: '2px 8px',
                  color: 'var(--color-on-status)',
                  background: 'var(--color-danger)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                }}
              >
                <Square size={10} aria-hidden />
                {t('stop', { defaultValue: 'Stop' })}
              </button>
            )}
          </>
        )}
      </div>

      <div style={{ height: 1, background: 'var(--color-border-subtle)' }} />
    </div>
  );
}
