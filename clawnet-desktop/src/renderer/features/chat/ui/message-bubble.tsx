import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Clock, Check, CheckCircle2, AlertCircle } from 'lucide-react';
import type { ChatMessage, MessageContentType, MessageStatus } from '../../../../shared/domain/chat';
import { Markdown } from '../../../components/markdown';
import { StreamingMarkdown } from './streaming-markdown';
import { FileMessageBubble } from './file-message-bubble';
import { ImageMessageBubble } from './image-message-bubble';
import { VideoMessageBubble } from './video-message-bubble';
import { VoiceMessageBubble } from './voice-message-bubble';
import { ApprovalCard } from './cards/approval-card';
import { TaskProgressCard } from './cards/task-progress-card';
import { TaskResultCard } from './cards/task-result-card';
import { DialogRequestCard } from './cards/dialog-request-card';
import { DialogApprovalCard } from './cards/dialog-approval-card';
import { IntentAuthorizationCard } from './cards/intent-authorization-card';
import { GenericRichCard } from './cards/generic-rich-card';
import { useStream } from '../hooks/use-stream';
import { useAuthStore } from '../../auth/state/auth-slice';
import { DiscoveryTaskCard } from '../../agents/ui/discovery-task-card';
import { useDiscoveryByConversation } from '../../agents/hooks/use-discovery';
import { RoleBadge } from './role-badge';
import { isOwnMessage, isGovernanceCard } from './message-side';

function DiscoveryProgressBubble({ conversationId }: { conversationId: string }) {
  const { data: task } = useDiscoveryByConversation(conversationId);
  if (!task) return null;
  return <DiscoveryTaskCard task={task} />;
}

interface RichCardRouteContent {
  cardType?: string;
  targetOwner?: { id?: string };
  initiatorOwner?: { id?: string };
}

/**
 * Renders the body of a message based on `contentType`. Mirrors the macOS
 * routing switch in `MessageBubble.swift:180-299` 1:1, including the
 * target-owner / initiator-owner skip rules for dialog cards and the
 * intent_authorization discriminator inside `rich_card`.
 *
 * Returns `null` when the message is filtered (system content, dialog cards
 * the current user initiated themselves, etc.).
 */
function renderContent(
  message: ChatMessage,
  isOwn: boolean,
  isStreaming: boolean,
  streamingText: string,
  currentUserId: string | null,
  t: TFunction<'chat'>,
): React.ReactNode {
  const contentType = message.contentType as MessageContentType;
  const route = message.content as RichCardRouteContent;
  const text =
    isStreaming && contentType === 'text'
      ? streamingText
      : ((message.content as { text?: string | null }).text ?? '');

  switch (contentType) {
    case 'text':
      return isStreaming ? (
        <StreamingMarkdown content={text} />
      ) : (
        <Markdown content={text} />
      );

    case 'image':
      return <ImageMessageBubble message={message} conversationId={message.conversationId} />;

    case 'video':
      return <VideoMessageBubble message={message} />;

    case 'voice':
      return <VoiceMessageBubble message={message} isOwn={isOwn} />;

    case 'file':
      return (
        <FileMessageBubble
          message={message}
          isOwn={isOwn}
          conversationId={message.conversationId}
        />
      );

    case 'system':
      return null;

    case 'rich_card':
      return route.cardType === 'intent_authorization' ? (
        <IntentAuthorizationCard message={message} />
      ) : (
        <GenericRichCard message={message} />
      );

    case 'task_progress':
      return <TaskProgressCard message={message} />;

    case 'task_result':
      return <TaskResultCard message={message} />;

    case 'dialog_request':
      // Skip when the current user is the target owner (they sent the request).
      if (route.targetOwner?.id && route.targetOwner.id === currentUserId) return null;
      return <DialogRequestCard message={message} />;

    case 'dialog_approval':
      // Skip when the current user initiated the dialog (they shouldn't see
      // their own approval request — the other side does).
      if (route.initiatorOwner?.id && route.initiatorOwner.id === currentUserId) return null;
      return <DialogApprovalCard message={message} />;

    case 'approval_request':
      return <ApprovalCard message={message} />;

    case 'dialog_status':
      return (
        <div
          style={{
            fontSize: 13,
            color: 'var(--color-text-secondary)',
            padding: '6px 12px',
            background: 'var(--color-bg-surface-2)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {text || `[${contentType}]`}
        </div>
      );

    case 'discovery_progress':
      return <DiscoveryProgressBubble conversationId={message.conversationId} />;

    default:
      return (
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {t('unsupportedContent')}
        </span>
      );
  }
}

function StatusIcon({ status }: { status: MessageStatus }) {
  switch (status) {
    case 'sending':
      return <Clock size={10} aria-hidden style={{ color: 'var(--color-text-muted)' }} />;
    case 'sent':
      return <Check size={10} aria-hidden style={{ color: 'var(--color-text-muted)' }} />;
    case 'read':
      return <CheckCircle2 size={10} aria-hidden style={{ color: 'var(--color-brand-500)' }} />;
    case 'failed':
      return <AlertCircle size={10} aria-hidden style={{ color: 'var(--color-danger)' }} />;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Returns the message's text content for copy. Empty string for non-text messages. */
function messageTextContent(m: ChatMessage): string {
  if (m.contentType === 'text') {
    const c = m.content as { text?: string | null };
    return c.text ?? '';
  }
  return '';
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isAgentDialog = false,
}: {
  message: ChatMessage;
  /** True when the parent conversation is an A2A (agent-task) dialog —
   *  enables the "my own agent's messages render on my side" rule. */
  isAgentDialog?: boolean;
}) {
  const { t } = useTranslation('chat');
  const { content: streamContent, isStreaming } = useStream(message.id);

  const myId = useAuthStore((s) => (s.state.kind === 'loggedIn' ? s.state.user.id : null));
  const isOwn = isOwnMessage(message.sender, myId, isAgentDialog);

  // Right-click to copy text content. Mirrors macOS MessageBubble.swift:109-118.
  // Hook must run before any early return below to satisfy rules-of-hooks.
  const textContent = messageTextContent(message);
  const onCopyContext = useCallback(
    (e: React.MouseEvent) => {
      if (!textContent) return;
      e.preventDefault();
      void navigator.clipboard.writeText(textContent);
    },
    [textContent],
  );

  const body = renderContent(message, isOwn, isStreaming, streamContent, myId, t);
  if (body === null) return null;

  const contentType = message.contentType;
  const isText = contentType === 'text';
  const isDiscovery = contentType === 'discovery_progress';
  const isFileLike =
    contentType === 'file' ||
    contentType === 'image' ||
    contentType === 'video' ||
    contentType === 'voice';

  // Per-message footer: HH:mm + status icon for own messages. Mirrors
  // MessageBubble.swift:120-133. Suppressed during streaming since the
  // bubble is still being assembled.
  const showStatus = isOwn && message.status && !isStreaming;
  const timestampLabel = message.timestamp ? formatTime(message.timestamp) : '';
  const metaRow = (timestampLabel || showStatus) && !isStreaming
    ? (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '0 4px',
          fontSize: 10,
          color: 'var(--color-text-muted)',
        }}
      >
        {showStatus && isOwn && message.status && <StatusIcon status={message.status} />}
        {timestampLabel && <span>{timestampLabel}</span>}
      </div>
    )
    : null;

  // Discovery + rich/media cards render outside the standard text bubble
  // chrome — they bring their own background/border. Text bubbles use the
  // existing brand-colored "own" vs. surface "other" treatment.
  if (isDiscovery) {
    return (
      <div
        className="flex flex-col gap-1"
        style={{ alignItems: 'flex-start', margin: '4px 0' }}
      >
        <div
          className="text-xs"
          style={{
            color: 'var(--color-text-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {message.sender.name}
          <RoleBadge role={message.sender.role} size="xs" />
        </div>
        <div className="max-w-[70%] w-full">{body}</div>
        {metaRow}
      </div>
    );
  }

  if (!isText) {
    // All media + rich-card variants share the same column wrapper as file
    // bubbles: name label + body, aligned by sender. A2A governance cards
    // (intent / dialog request / dialog approval / approval request) are
    // system-style prompts — centered, with no per-sender name label.
    const governance = isGovernanceCard(message);
    return (
      <div
        className="flex flex-col gap-1"
        style={{
          alignItems: governance ? 'center' : isOwn ? 'flex-end' : 'flex-start',
          margin: '4px 0',
        }}
      >
        {!governance && (
          <div
            className="text-xs"
            style={{
              color: 'var(--color-text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {message.sender.name}
            <RoleBadge role={message.sender.role} size="xs" />
          </div>
        )}
        {isFileLike ? body : <div className="max-w-[70%]">{body}</div>}
        {metaRow}
      </div>
    );
  }

  // Text path — preserves the streaming-bubble testid + brand colors.
  return (
    <div
      className="flex flex-col gap-1"
      style={{
        alignItems: isOwn ? 'flex-end' : 'flex-start',
        margin: '4px 0',
      }}
    >
      <div
        className="text-xs"
        style={{
          color: 'var(--color-text-muted)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {message.sender.name}
        <RoleBadge role={message.sender.role} size="xs" />
      </div>
      <div
        data-testid={isStreaming ? 'streaming-bubble' : undefined}
        onContextMenu={onCopyContext}
        title={textContent ? t('copyHint', { defaultValue: 'Right-click to copy' }) : undefined}
        className="px-3 py-2 max-w-[70%]"
        style={{
          background: isOwn ? 'var(--color-brand-500)' : 'var(--color-bg-surface-2)',
          color: isOwn ? 'var(--color-on-status)' : 'var(--color-text-primary)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        {body}
      </div>
      {metaRow}
    </div>
  );
});
