import { contextBridge } from 'electron';
import { buildApi } from './ipc-bridge';
import { installRendererErrorListener } from './error-listener';
installRendererErrorListener();

const api = buildApi();

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('clawnet', api);
} else {
  // contextIsolation must be enabled — fail loud if it isn't
  throw new Error(
    'clawnet preload requires contextIsolation: true (security baseline, see spec §2.3)',
  );
}

declare global {
  interface Window {
    clawnet: typeof api;
  }
}
