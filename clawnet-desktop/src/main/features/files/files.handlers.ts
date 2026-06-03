import type { IpcRouter } from '../../core/ipc-router';
import { Requests as IpcRequests } from '../../../shared/ipc-contract';
import type { FileService } from '../../network/file-service';

/**
 * Wires top-level `files.*` IPC channels to the main-process FileService.
 * Currently only `files.search` (P2F). The chat send/download pipeline keeps
 * its own `chat.sendFile` / `chat.downloadFile` channels since those are
 * conversation-scoped.
 */
export function registerFilesHandlers(router: IpcRouter, files: FileService): void {
  router.register('files.search', {
    input: IpcRequests['files.search'].input,
    output: IpcRequests['files.search'].output,
    handler: async ({ query }) => files.searchFiles(query),
  });
}
