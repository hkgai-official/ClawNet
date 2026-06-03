import { useState } from 'react';
import { TitleBar } from './titlebar';
import { ErrorBoundary } from './error-boundary';
import { Providers } from './providers';
import { Router } from './router';
import { ChatContainer } from '../features/chat/ui/chat-container';
import { AppSidebar } from './app-sidebar';
import type { ActivePanel } from './active-panel';
import { ContactsPanel } from '../features/contacts/ui/contacts-panel';
import { ContactDetailView } from '../features/contacts/ui/contact-detail';
import { AgentsPanel } from '../features/agents/ui/agents-panel';
import { SettingsLayout } from '../features/profile/ui/settings-layout';
import { SecurityEventCenter } from '../features/audit/ui/security-event-center';
import { useIntentAuthTargets } from '../features/agents/hooks/use-intent-auth-targets';
import { useDialogTerminationToast } from '../features/agents/hooks/use-dialog-termination-toast';
import { useMessageNotifications } from '../features/chat/hooks/use-message-notifications';
import { GlobalSearchModal } from '../features/search/ui/global-search-modal';
import { KeyboardShortcuts } from './keyboard-shortcuts';

function MainShell() {
  useIntentAuthTargets();
  useDialogTerminationToast();
  const [activePanel, setActivePanel] = useState<ActivePanel>('chat');
  // In-app banner for new messages in non-active conversations. Click
  // routes the user to the chat panel + the originating conversation.
  useMessageNotifications(() => setActivePanel('chat'));

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-app)' }}>
      <TitleBar />
      <main className="flex-1 min-h-0 flex w-full">
        <AppSidebar active={activePanel} onChange={setActivePanel} />
        <div className="flex-1 min-w-0 flex">
          {activePanel === 'chat' && <ChatContainer />}
          {activePanel === 'contacts' && (
            <>
              <ContactsPanel />
              <ContactDetailView onOpenChat={() => setActivePanel('chat')} />
            </>
          )}
          {activePanel === 'agents' && <AgentsPanel />}
          {activePanel === 'security' && <SecurityEventCenter />}
          {activePanel === 'settings' && <SettingsLayout />}
        </div>
      </main>
      <KeyboardShortcuts onSwitchPanel={setActivePanel} />
      <GlobalSearchModal onSwitchPanel={setActivePanel} />
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <Providers>
        <Router mainShell={<MainShell />} />
      </Providers>
    </ErrorBoundary>
  );
}
