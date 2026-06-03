import type { IpcRouter } from '../../core/ipc-router';
import { Requests as IpcRequests } from '../../../shared/ipc-contract';
import type { TagService } from './tag.service';

/**
 * Wires `tags.*` IPC channels to the main-process TagService.
 * 1:1 with macOS TagService.swift entry points.
 */
export function registerTagsHandlers(router: IpcRouter, tags: TagService): void {
  router.register('tags.list', {
    input: IpcRequests['tags.list'].input,
    output: IpcRequests['tags.list'].output,
    handler: async () => tags.list(),
  });
  router.register('tags.create', {
    input: IpcRequests['tags.create'].input,
    output: IpcRequests['tags.create'].output,
    handler: async (input) => tags.create(input),
  });
  router.register('tags.update', {
    input: IpcRequests['tags.update'].input,
    output: IpcRequests['tags.update'].output,
    handler: async ({ id, ...rest }) => tags.update(id, rest),
  });
  router.register('tags.delete', {
    input: IpcRequests['tags.delete'].input,
    output: IpcRequests['tags.delete'].output,
    handler: async ({ id }) => { await tags.delete(id); },
  });
}
