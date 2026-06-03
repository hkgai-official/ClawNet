import { Requests } from '../../../shared/ipc-contract';
import type { IpcRouter } from '../../core/ipc-router';
import type { AgentService } from './agent.service';
import type { DialogService } from './dialog.service';
import type { DiscoveryService } from './discovery.service';
import type { TaskService } from './task.service';

export function registerAgentsHandlers(router: IpcRouter, deps: {
  agents: AgentService;
  dialogs: DialogService;
  discovery: DiscoveryService;
  tasks: TaskService;
}): void {
  // agents.*
  router.register('agents.list', { input: Requests['agents.list'].input, output: Requests['agents.list'].output, handler: async () => deps.agents.list() });
  router.register('agents.get', { input: Requests['agents.get'].input, output: Requests['agents.get'].output, handler: async ({ id }) => deps.agents.get(id) });
  router.register('agents.contactable', { input: Requests['agents.contactable'].input, output: Requests['agents.contactable'].output, handler: async () => deps.agents.contactable() });
  router.register('agents.create', {
    input: Requests['agents.create'].input,
    output: Requests['agents.create'].output,
    handler: async ({ config, tagId, tagRole }) => {
      const opts: { tagId?: string; tagRole?: string } = {};
      if (tagId !== undefined) opts.tagId = tagId;
      if (tagRole !== undefined) opts.tagRole = tagRole;
      return deps.agents.createAgent(config, opts);
    },
  });
  router.register('agents.update', {
    input: Requests['agents.update'].input,
    output: Requests['agents.update'].output,
    handler: async ({ id, config, tagId, tagRole }) => {
      const opts: { tagId?: string; tagRole?: string } = {};
      if (tagId !== undefined) opts.tagId = tagId;
      if (tagRole !== undefined) opts.tagRole = tagRole;
      return deps.agents.updateAgent(id, config, opts);
    },
  });
  router.register('agents.delete', {
    input: Requests['agents.delete'].input,
    output: Requests['agents.delete'].output,
    handler: async ({ id }) => { await deps.agents.deleteAgent(id); },
  });
  // dialogs.* — 10 channels (intentAuthorize sends a WS envelope; the rest hit HTTP)
  router.register('dialogs.intentAuthorize', {
    input: Requests['dialogs.intentAuthorize'].input,
    output: Requests['dialogs.intentAuthorize'].output,
    handler: async ({ authorizationId, approved }) => {
      deps.dialogs.intentAuthorize(authorizationId, approved);
    },
  });
  router.register('dialogs.create', { input: Requests['dialogs.create'].input, output: Requests['dialogs.create'].output, handler: async (v) => deps.dialogs.create(v) });
  router.register('dialogs.list', { input: Requests['dialogs.list'].input, output: Requests['dialogs.list'].output, handler: async ({ status }) => deps.dialogs.list(status) });
  router.register('dialogs.getByConv', { input: Requests['dialogs.getByConv'].input, output: Requests['dialogs.getByConv'].output, handler: async ({ conversationId }) => deps.dialogs.getByConv(conversationId) });
  router.register('dialogs.approve', { input: Requests['dialogs.approve'].input, output: Requests['dialogs.approve'].output, handler: async ({ sessionId, approved, reason }) => deps.dialogs.approve(sessionId, approved, reason) });
  router.register('dialogs.requestMain', { input: Requests['dialogs.requestMain'].input, output: Requests['dialogs.requestMain'].output, handler: async ({ sessionId }) => deps.dialogs.requestMain(sessionId) });
  router.register('dialogs.refine', { input: Requests['dialogs.refine'].input, output: Requests['dialogs.refine'].output, handler: async ({ sessionId, target, instruction }) => deps.dialogs.refine(sessionId, target, instruction) });
  router.register('dialogs.submitResponse', { input: Requests['dialogs.submitResponse'].input, output: Requests['dialogs.submitResponse'].output, handler: async ({ sessionId, text }) => deps.dialogs.submitResponse(sessionId, text) });
  router.register('dialogs.terminate', { input: Requests['dialogs.terminate'].input, output: Requests['dialogs.terminate'].output, handler: async ({ sessionId, reason }) => deps.dialogs.terminate(sessionId, reason) });
  router.register('dialogs.extend', { input: Requests['dialogs.extend'].input, output: Requests['dialogs.extend'].output, handler: async ({ sessionId, additionalRounds }) => deps.dialogs.extend(sessionId, additionalRounds) });
  // discovery.* — 5
  router.register('discovery.list', { input: Requests['discovery.list'].input, output: Requests['discovery.list'].output, handler: async ({ status }) => deps.discovery.list(status) });
  router.register('discovery.get', { input: Requests['discovery.get'].input, output: Requests['discovery.get'].output, handler: async ({ id }) => deps.discovery.get(id) });
  router.register('discovery.getByConv', { input: Requests['discovery.getByConv'].input, output: Requests['discovery.getByConv'].output, handler: async ({ conversationId }) => deps.discovery.getByConv(conversationId) });
  router.register('discovery.confirm', { input: Requests['discovery.confirm'].input, output: Requests['discovery.confirm'].output, handler: async ({ id, queries }) => deps.discovery.confirm(id, queries) });
  router.register('discovery.cancel', { input: Requests['discovery.cancel'].input, output: Requests['discovery.cancel'].output, handler: async ({ id, reason }) => deps.discovery.cancel(id, reason) });
  // tasks.* — 5
  router.register('tasks.create', { input: Requests['tasks.create'].input, output: Requests['tasks.create'].output, handler: async (v) => deps.tasks.create(v) });
  router.register('tasks.get', { input: Requests['tasks.get'].input, output: Requests['tasks.get'].output, handler: async ({ id }) => deps.tasks.get(id) });
  router.register('tasks.approve', { input: Requests['tasks.approve'].input, output: Requests['tasks.approve'].output, handler: async ({ id, decision, modifications }) => deps.tasks.approve(id, decision, modifications) });
  router.register('tasks.cancel', { input: Requests['tasks.cancel'].input, output: Requests['tasks.cancel'].output, handler: async ({ id }) => deps.tasks.cancel(id) });
  router.register('tasks.getLogs', { input: Requests['tasks.getLogs'].input, output: Requests['tasks.getLogs'].output, handler: async ({ id }) => deps.tasks.getLogs(id) });
}
