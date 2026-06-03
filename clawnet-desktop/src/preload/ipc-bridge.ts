import { ipcRenderer, webUtils } from 'electron';
import type { Result } from '../shared/result';
import type { ClawnetApi, Platform } from '../shared/clawnet-api';

export type { ClawnetApi } from '../shared/clawnet-api';

function detectPlatform(): Platform {
  switch (process.platform) {
    case 'darwin': return 'darwin';
    case 'win32': return 'win32';
    default: return 'linux';
  }
}

export function buildApi(): ClawnetApi {
  return {
    invoke: async (name, input) => {
      const res = await ipcRenderer.invoke(name as string, input);
      return res as Result<unknown, string> as never;
    },
    on: (name, listener) => {
      const wrapped = (_event: unknown, payload: unknown) =>
        listener(payload as Parameters<typeof listener>[0]);
      ipcRenderer.on(name as string, wrapped);
      return () => ipcRenderer.removeListener(name as string, wrapped);
    },
    platform: detectPlatform(),
    // `File.path` was removed in Electron 32 — `webUtils.getPathForFile`
    // is the supported replacement. Returns '' for non-filesystem files
    // (browser blobs, dragged from a webpage); callers treat empty as
    // "rejected, not a native file".
    getPathForFile: (file: File) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    },
  };
}
