import { useEffect } from 'react';
import type { EventName, EventPayload } from '../../shared/ipc-contract';
import { Events } from '../../shared/ipc-contract';

export function useIpcEvent<N extends EventName>(
  name: N,
  listener: (payload: EventPayload<typeof Events[N]>) => void,
): void {
  useEffect(() => {
    const unsub = window.clawnet.on(name, listener);
    return unsub;
  }, [name, listener]);
}
