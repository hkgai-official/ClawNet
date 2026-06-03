import { shell } from 'electron';
import type { IpcRouter } from '../../core/ipc-router';
import { Requests } from '../../../shared/ipc-contract';

/**
 * Registers `shell.*` IPC channels:
 *  - `shell.openPath` — open a path in the OS default app (Electron
 *    `shell.openPath` resolves to '' on success, error string on failure).
 *  - `shell.showItemInFolder` — reveal a path in the OS file explorer
 *    (mirrors macOS NSWorkspace.selectFile; Electron's call returns void
 *    and may throw for invalid paths — we catch and surface as `ok:false`).
 */
export function registerShellHandlers(router: IpcRouter): void {
  router.register('shell.openPath', {
    input: Requests['shell.openPath'].input,
    output: Requests['shell.openPath'].output,
    handler: async ({ path }) => {
      const result = await shell.openPath(path);
      return result === '' ? { ok: true } : { ok: false, error: result };
    },
  });
  router.register('shell.showItemInFolder', {
    input: Requests['shell.showItemInFolder'].input,
    output: Requests['shell.showItemInFolder'].output,
    handler: async ({ path }) => {
      try {
        shell.showItemInFolder(path);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  });
}
