import { useIpcEvent } from '../../../hooks/use-ipc-event';
import { useIntentAuthTargetsStore } from '../state/intent-auth-targets-slice';

type RequestSentArg = Parameters<
  ReturnType<typeof useIntentAuthTargetsStore.getState>['applyRequestSent']
>[0];
type StatusChangedArg = Parameters<
  ReturnType<typeof useIntentAuthTargetsStore.getState>['applyStatusChanged']
>[0];

/**
 * Wire the two IPC events that drive per-target status on the
 * IntentAuthorizationCard. Mount once at the app shell — listeners
 * stay attached for the lifetime of the renderer session.
 *
 *   dialog.request.sent  → applyRequestSent (binds sessionId ↔ target)
 *   dialog.status.changed → applyStatusChanged (status + round info)
 *
 * Note: the inferred zod payload types include `T | undefined` for optional
 * fields, but the slice signatures use bare `T?` (exactOptionalPropertyTypes).
 * Cast at the call site rather than loosen the slice contract.
 */
export function useIntentAuthTargets(): void {
  useIpcEvent('dialog.request.sent', (frame) => {
    useIntentAuthTargetsStore.getState().applyRequestSent(frame as RequestSentArg);
  });
  useIpcEvent('dialog.status.changed', (frame) => {
    useIntentAuthTargetsStore.getState().applyStatusChanged(frame as StatusChangedArg);
  });
}
