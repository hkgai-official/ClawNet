import type { ChatMessage } from '../../../../../shared/domain/chat';

interface Props {
  message: ChatMessage;
}

function cardIcon(mime: string | null | undefined): string {
  switch (mime) {
    case 'file_card':
      return '📄';
    case 'reference_card':
      return '🔗';
    case 'execution_log':
      return '💻';
    case 'citation_card':
      return '💬';
    default:
      return '🗂';
  }
}

/**
 * Generic rich-card fallback. Renders `MessageContent.name + .text + .url`
 * with an icon picked from `content.mimeType`. Ports macOS
 * `RichCardViews.swift:550-602` (RichCardView).
 *
 * `execution_log` and `code` mime types use a monospace pre block (matching
 * the macOS ScrollView/Monospaced variant); other types use plain prose.
 */
export function GenericRichCard({ message }: Props) {
  const c = message.content as {
    name?: string | null;
    text?: string | null;
    url?: string | null;
    mimeType?: string | null;
  };
  const isMonospace = c.mimeType === 'execution_log' || c.mimeType === 'code';

  return (
    <div
      data-testid="generic-rich-card"
      style={{
        padding: 12,
        maxWidth: 280,
        background: 'var(--color-bg-overlay)',
        borderRadius: 10,
        border: '1px solid var(--color-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {c.name && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{cardIcon(c.mimeType)}</span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</span>
        </div>
      )}
      {c.text &&
        (isMonospace ? (
          <pre
            style={{
              fontFamily: 'monospace',
              fontSize: 11,
              padding: 8,
              background: 'var(--color-bg-surface-2)',
              borderRadius: 6,
              maxHeight: 120,
              overflow: 'auto',
              margin: 0,
            }}
          >
            {c.text}
          </pre>
        ) : (
          <div style={{ fontSize: 13 }}>{c.text}</div>
        ))}
      {c.url && (
        <a
          href={c.url}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 11, color: 'var(--color-info)' }}
        >
          {c.url}
        </a>
      )}
    </div>
  );
}
