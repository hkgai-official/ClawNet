import { useDialogDraftStore } from '../state/dialog-draft-slice';
import { useIpcEvent } from '../../../hooks/use-ipc-event';

// Subscribes the dialog-draft store to the dialog.draft.updated IPC event,
// then returns the current draft state for a given sessionId. The push
// payload arrives camelCased (deep-converted at the boundary in
// agent-event-bus). Drafts that arrive while the renderer is closed are
// lost until the next refine action — acceptable per macOS behavior.

export function useDialogDraft(sessionId: string | null) {
  const update = useDialogDraftStore((s) => s.updateDraft);

  useIpcEvent('dialog.draft.updated', (payload) => {
    if (payload && typeof payload === 'object') {
      update(payload as Parameters<typeof update>[0]);
    }
  });

  return useDialogDraftStore((s) => (sessionId ? s.drafts[sessionId] : undefined));
}
