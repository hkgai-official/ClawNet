import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ConversationList } from './conversation-list';
import { MessageList } from './message-list';
import { Composer } from './composer';
import { DropZone } from './drop-zone';
import { StatusBar } from './status-bar';
import { ChatHeaderBar } from './chat-header-bar';
import { useChatStore } from '../state/chat-slice';
import { useAuthStore } from '../../auth/state/auth-slice';
import { useGroupStore } from '../state/group-slice';
import { useStreamEvents } from '../hooks/use-stream';
import { useConversations } from '../hooks/use-conversations';
import { useMessages } from '../hooks/use-messages';
import { useDownloadEventsSubscriber } from '../hooks/use-file-download';
import { useIpc } from '../../../hooks/use-ipc';
import { A2AReviewSurface } from '../../agents/ui/a2a-review-surface';
import { ExecutionLogDrawer } from '../../agents/ui/execution-log-drawer';
import { AgentDialogWizard } from '../../agents/ui/agent-dialog-wizard';
import { NewChatModal } from './new-chat-modal';
import { NewGroupModal } from './new-group-modal';
import { InviteMembersModal } from './invite-members-modal';
import { GroupDetailPanel } from './group-detail-panel';

// Fixed width for the ConversationList aside. Matches macOS sidebar default
// (a deliberate constant — the chat pane should be the only flexing region).
const CONVERSATION_LIST_WIDTH = 280;

export function ChatContainer() {
  useStreamEvents();
  // Register the chat.download.* IPC subscribers ONCE at this layer so the
  // FileMessageBubbles below all share a single set of listeners (previously
  // every bubble registered its own copy → 4 × N listeners for N file
  // messages on screen).
  useDownloadEventsSubscriber();
  const activeId = useChatStore((s) => s.activeConversationId);
  const ipc = useIpc();
  const qc = useQueryClient();

  const groupDetailOpen = useGroupStore((s) => s.groupDetailOpen);
  const setGroupDetailOpen = useGroupStore((s) => s.setGroupDetailOpen);
  const conversations = useConversations();
  const messagesForActive = useMessages(activeId);
  const activeConv = conversations.data?.find((c) => c.id === activeId);
  // An A2A dialog conversation (type === 'agent_task') is driven by the
  // A2AReviewSurface — never the free-type composer, regardless of the
  // dialog's status.
  const isA2AConversation = activeConv?.type === 'agent_task';
  const currentUserId = useAuthStore((s) =>
    s.state.kind === 'loggedIn' ? s.state.user.id : null,
  );

  // When a user opens (or switches to) a conversation that has unread
  // messages, mark it read on the server so the badge clears. Mirrors
  // macOS ChatService.markRead behavior at conversation-open time.
  useEffect(() => {
    if (!activeId || !activeConv || activeConv.unreadCount === 0) return;
    const last = messagesForActive.data?.messages.at(-1);
    if (!last) return;
    void ipc('chat.conversations.markRead', { id: activeId, lastReadMessageId: last.id })
      .then(() => qc.invalidateQueries({ queryKey: ['chat.conversations'] }))
      .catch(() => undefined);
  }, [activeId, activeConv, messagesForActive.data?.messages, ipc, qc]);

  return (
    <>
      <div
        className="flex-1 min-w-0 flex h-full"
        style={{ background: 'var(--color-bg-app)' }}
      >
        <aside
          style={{
            width: CONVERSATION_LIST_WIDTH,
            flexShrink: 0,
            borderRight: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg-surface)',
          }}
        >
          <ConversationList />
        </aside>

        <section className="flex-1 flex flex-col min-w-0 min-h-0">
          <StatusBar />
          {activeId ? (
            <DropZone conversationId={activeId}>
              <div className="flex flex-col h-full">
                {activeConv && (
                  <ChatHeaderBar
                    conversation={activeConv}
                    currentUserId={currentUserId}
                    onGroupDetail={
                      activeConv.type === 'group'
                        ? () => setGroupDetailOpen(!groupDetailOpen)
                        : undefined
                    }
                  />
                )}
                <div
                  className="flex-1 min-h-0 flex flex-col"
                  style={{ background: 'var(--color-bg-app)' }}
                >
                  <MessageList conversationId={activeId} />
                </div>
                <A2AReviewSurface conversationId={activeId} />
                {!isA2AConversation && <Composer conversationId={activeId} />}
              </div>
            </DropZone>
          ) : (
            <>
              <div
                className="flex-1 min-h-0 flex flex-col"
                style={{ background: 'var(--color-bg-app)' }}
              >
                <MessageList conversationId={activeId} />
              </div>
              <Composer conversationId={activeId} />
            </>
          )}
        </section>
      </div>
      {activeConv?.type === 'group' && groupDetailOpen && <GroupDetailPanel />}
      <ExecutionLogDrawer />
      <NewChatModal />
      <NewGroupModal />
      <AgentDialogWizard />
      <InviteMembersModal />
    </>
  );
}
