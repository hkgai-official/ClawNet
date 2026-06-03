import { useEffect, useState } from 'react';
import type { ConnectionStatus } from '../../shared/domain/auth';
import { useIpc } from './use-ipc';
import { useIpcEvent } from './use-ipc-event';

export interface ConnectionState {
  status: ConnectionStatus;
  lastError: string | null;
  reconnectAttempt: number;
}

export function useConnection(): ConnectionState & { manualReconnect: () => Promise<void> } {
  const ipc = useIpc();
  const [state, setState] = useState<ConnectionState>({
    status: 'disconnected',
    lastError: null,
    reconnectAttempt: 0,
  });

  useEffect(() => {
    ipc('connection.status', {}).then((s) => setState((prev) => ({ ...prev, status: s })));
  }, [ipc]);

  useIpcEvent('connection.statusChanged', (e) => {
    setState(e);
  });

  return {
    ...state,
    manualReconnect: async () => { await ipc('connection.manualReconnect', {}); },
  };
}
