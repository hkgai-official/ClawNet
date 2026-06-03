import { useCallback } from 'react';
import type { RequestName, RequestInput, RequestOutput } from '../../shared/ipc-contract';
import { Requests } from '../../shared/ipc-contract';

export class IpcInvocationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'IpcInvocationError';
  }
}

export function useIpc() {
  return useCallback(
    async <N extends RequestName>(
      name: N,
      input: RequestInput<typeof Requests[N]>,
    ): Promise<RequestOutput<typeof Requests[N]>> => {
      const res = await window.clawnet.invoke(name, input);
      if (!res.ok) throw new IpcInvocationError(res.error.code, res.error.message);
      return res.data;
    },
    [],
  );
}
