import { ipcRenderer } from 'electron';

const CHANNEL = 'renderer.error';

export function installRendererErrorListener(): void {
  window.addEventListener('error', (e) => {
    ipcRenderer.send(CHANNEL, {
      kind: 'error',
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      stack: e.error instanceof Error ? e.error.stack : undefined,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? e.reason.stack ?? e.reason.message : String(e.reason);
    ipcRenderer.send(CHANNEL, {
      kind: 'unhandledrejection',
      reason,
    });
  });
}
