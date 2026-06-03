import type { IpcRouter } from '../../core/ipc-router';
import { Requests as IpcRequests } from '../../../shared/ipc-contract';
import type { ContactService } from './contact.service';

/**
 * Wires `contacts.*` and `friendRequests.*` IPC channels to the main-process
 * ContactService. 1:1 with macOS ContactService.swift entry points.
 */
export function registerContactsHandlers(router: IpcRouter, contacts: ContactService): void {
  router.register('contacts.list', {
    input: IpcRequests['contacts.list'].input,
    output: IpcRequests['contacts.list'].output,
    handler: async () => contacts.list(),
  });
  router.register('contacts.search', {
    input: IpcRequests['contacts.search'].input,
    output: IpcRequests['contacts.search'].output,
    handler: async ({ query }) => contacts.search(query),
  });
  router.register('contacts.add', {
    input: IpcRequests['contacts.add'].input,
    output: IpcRequests['contacts.add'].output,
    handler: async ({ contactId, contactType }) => contacts.add(contactId, contactType ?? 'human'),
  });
  router.register('contacts.delete', {
    input: IpcRequests['contacts.delete'].input,
    output: IpcRequests['contacts.delete'].output,
    handler: async ({ contactId }) => { await contacts.delete(contactId); },
  });
  router.register('contacts.updateTag', {
    input: IpcRequests['contacts.updateTag'].input,
    output: IpcRequests['contacts.updateTag'].output,
    handler: async ({ contactId, tagId }) => contacts.updateTag(contactId, tagId),
  });
  router.register('friendRequests.list', {
    input: IpcRequests['friendRequests.list'].input,
    output: IpcRequests['friendRequests.list'].output,
    handler: async () => contacts.listFriendRequests(),
  });
  router.register('friendRequests.send', {
    input: IpcRequests['friendRequests.send'].input,
    output: IpcRequests['friendRequests.send'].output,
    handler: async ({ toUserId, message }) => contacts.sendFriendRequest(toUserId, message),
  });
  router.register('friendRequests.accept', {
    input: IpcRequests['friendRequests.accept'].input,
    output: IpcRequests['friendRequests.accept'].output,
    handler: async ({ id }) => { await contacts.acceptFriendRequest(id); },
  });
  router.register('friendRequests.reject', {
    input: IpcRequests['friendRequests.reject'].input,
    output: IpcRequests['friendRequests.reject'].output,
    handler: async ({ id }) => { await contacts.rejectFriendRequest(id); },
  });
}
