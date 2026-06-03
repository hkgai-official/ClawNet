import { useEffect } from 'react';
import { useGlobalSearchStore } from '../features/search/state/global-search-slice';
import { useGroupStore } from '../features/chat/state/group-slice';
import { useAgentsStore } from '../features/agents/state/agents-slice';
import type { ActivePanel } from './active-panel';

/**
 * App-wide keyboard shortcuts. Mirrors the macOS shortcut set:
 *
 *   Cmd/Ctrl + F  → open global search
 *   Cmd/Ctrl + N  → open the new-conversation picker
 *   Cmd/Ctrl + ,  → switch to Settings panel
 *   Escape        → close any open modal / drawer
 *
 * Each handler skips when focus is on an editable element (textarea /
 * input / contentEditable) so the keystroke can fall through to native
 * find / browser behavior. The Cmd+F skip is the only one that's
 * unconditional — typing-while-finding is the typical desktop expectation.
 *
 * Renders nothing; this is a side-effect-only component.
 */
export function KeyboardShortcuts({
  onSwitchPanel,
}: {
  onSwitchPanel: (panel: ActivePanel) => void;
}): null {
  const openSearch = useGlobalSearchStore((s) => s.open);
  const closeSearch = useGlobalSearchStore((s) => s.close);
  const openNewChatModal = useGroupStore((s) => s.openNewChatModal);
  const closeNewChatModal = useGroupStore((s) => s.closeNewChatModal);
  const closeNewGroupModal = useGroupStore((s) => s.closeNewGroupModal);
  const closeAgentDialogWizard = useGroupStore((s) => s.closeAgentDialogWizard);
  const closeInviteModal = useGroupStore((s) => s.closeInviteModal);
  const setGroupDetailOpen = useGroupStore((s) => s.setGroupDetailOpen);
  const setLogDrawer = useAgentsStore((s) => s.setLogDrawer);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable =
        tag === 'textarea' ||
        tag === 'input' ||
        target?.isContentEditable === true;

      const isMod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl + F — global search. Skip while inside a textarea so
      // long-composer users can still hit native find if their platform
      // wires one. Input fields don't matter — search should be reachable
      // even from the inline search box.
      if (isMod && e.key.toLowerCase() === 'f') {
        if (tag === 'textarea') return;
        e.preventDefault();
        openSearch();
        return;
      }

      // Cmd/Ctrl + N — new conversation
      if (isMod && e.key.toLowerCase() === 'n') {
        if (isEditable) return;
        e.preventDefault();
        openNewChatModal();
        return;
      }

      // Cmd/Ctrl + , — settings
      if (isMod && e.key === ',') {
        if (isEditable) return;
        e.preventDefault();
        onSwitchPanel('settings');
        return;
      }

      // Esc — close any open modal / drawer in this order:
      //   global search > newChat > newGroup > agentDialog > invite
      //   > group detail > log drawer
      if (e.key === 'Escape') {
        const search = useGlobalSearchStore.getState();
        const group = useGroupStore.getState();
        const agents = useAgentsStore.getState();
        if (search.isOpen) { closeSearch(); return; }
        if (group.newChatModalOpen) { closeNewChatModal(); return; }
        if (group.newGroupModalOpen) { closeNewGroupModal(); return; }
        if (group.agentDialogWizardOpen) { closeAgentDialogWizard(); return; }
        if (group.inviteModalForConversationId) { closeInviteModal(); return; }
        if (group.groupDetailOpen) { setGroupDetailOpen(false); return; }
        if (agents.logDrawerOpenForTaskId) { setLogDrawer(null); return; }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    openSearch,
    closeSearch,
    openNewChatModal,
    closeNewChatModal,
    closeNewGroupModal,
    closeAgentDialogWizard,
    closeInviteModal,
    setGroupDetailOpen,
    setLogDrawer,
    onSwitchPanel,
  ]);
  return null;
}
