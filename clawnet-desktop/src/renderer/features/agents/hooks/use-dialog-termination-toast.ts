import { useTranslation } from 'react-i18next';
import { useIpcEvent } from '../../../hooks/use-ipc-event';
import { toastStore } from '../../../components/toast-overlay';

/**
 * Global toast for A2A dialog termination. Subscribes once at the app
 * shell so the user gets a visible signal when the other party rejects
 * or ends a dialog — required because the IntentAuthCard / A2A panel
 * only refresh if the user happens to be looking at the right
 * conversation, and the in-chat `[System] ...` line is too low-profile
 * to be noticed reliably.
 *
 * Discriminator: a structural transition `pending_approval → terminated`
 * is a recipient rejection (warning toast); any other transition into
 * `terminated` (active → terminated, paused → terminated, etc.) is an
 * end-of-life event from either side (info toast). Earlier drafts read
 * the free-form `terminationReason` string with /reject/i, which broke
 * once the server passed a localized custom reason. Now we key off
 * `oldStatus` which the server always sets on `dialog.status_change`.
 *
 * Both flavours surface a toast; we don't try to suppress the
 * self-terminate case (would require tracking which mutations this
 * user fired) — minor duplicate-feedback cost is worth the bullet-proof
 * "you definitely saw it" property.
 */
export function useDialogTerminationToast(): void {
  const { t } = useTranslation('agent');
  useIpcEvent('dialog.status.changed', (frame) => {
    if (frame.status !== 'terminated') return;
    const isReject = frame.oldStatus === 'pending_approval';
    toastStore.getState().push({
      message: isReject
        ? t('dialogRejectedToast', {
            defaultValue: 'The other party rejected the A2A dialog',
          })
        : t('dialogTerminatedToast', {
            defaultValue: 'A2A dialog ended',
          }),
      level: isReject ? 'warning' : 'info',
    });
  });
}
