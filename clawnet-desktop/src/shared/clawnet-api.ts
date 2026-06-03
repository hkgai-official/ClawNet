// src/shared/clawnet-api.ts
// ClawnetApi is defined in shared so both preload and renderer tsconfigs can reference it.
import type { RequestName, RequestInput, RequestOutput, EventName, EventPayload } from './ipc-contract';
import type { Requests, Events } from './ipc-contract';
import type { Result } from './result';

export type Platform = 'darwin' | 'win32' | 'linux';

export type ClawnetApi = {
  invoke: <N extends RequestName>(
    name: N,
    input: RequestInput<typeof Requests[N]>,
  ) => Promise<Result<RequestOutput<typeof Requests[N]>, string>>;
  on: <N extends EventName>(
    name: N,
    listener: (payload: EventPayload<typeof Events[N]>) => void,
  ) => () => void;
  /** Host platform — exposed by preload from node `process.platform`. */
  platform: Platform;
  /**
   * Resolve a dropped/picked `File` to its OS path. `File.path` was
   * removed in Electron 32 — the supported replacement is
   * `webUtils.getPathForFile(file)`, which only runs in the preload
   * context. Returns empty string if the file isn't a native filesystem
   * file (browser blob, drag from a webpage, etc.). */
  getPathForFile: (file: File) => string;
};
