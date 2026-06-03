// src/renderer/features/update/hooks/use-update-status.ts
//
// Renderer hook for the auto-update flow:
//   - Subscribes to `app.updateStatus` events for live state pushes from main.
//   - Exposes `check()` to trigger `app.checkForUpdates` on demand.
//   - Exposes `restart()` to invoke `app.quitAndInstall` after a download is ready.
//
// Listener wrapped in useCallback to keep useIpcEvent from resubscribing on
// every render (same pattern as use-audit-events.ts).

import { useCallback, useState } from 'react';
import { useIpc } from '../../../hooks/use-ipc';
import { useIpcEvent } from '../../../hooks/use-ipc-event';
import type { UpdateStatus } from '../../../../shared/domain/update-status';

export function useUpdateStatus() {
  const ipc = useIpc();
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });

  const handleStatus = useCallback((s: UpdateStatus) => {
    setStatus(s);
  }, []);
  useIpcEvent('app.updateStatus', handleStatus);

  const check = useCallback(async () => {
    const result = await ipc('app.checkForUpdates', {});
    setStatus(result);
  }, [ipc]);

  const restart = useCallback(async () => {
    await ipc('app.quitAndInstall', {});
  }, [ipc]);

  return { status, check, restart };
}
