import { z } from 'zod';
import { defineRequest, defineEvent } from './_common';
import { AgentSchema, AgentConfigSchema } from '../domain/agent';

export const AgentsRequests = {
  'agents.list': defineRequest({
    input: z.object({}),
    output: z.array(AgentSchema),
  }),
  'agents.get': defineRequest({
    input: z.object({ id: z.string() }),
    output: AgentSchema,
  }),
  'agents.contactable': defineRequest({
    input: z.object({}),
    output: z.array(AgentSchema),
  }),
  'agents.create': defineRequest({
    input: z.object({
      config: AgentConfigSchema,
      tagId: z.string().optional(),
      tagRole: z.string().optional(),
    }),
    output: AgentSchema,
  }),
  'agents.update': defineRequest({
    input: z.object({
      id: z.string(),
      config: AgentConfigSchema,
      tagId: z.string().optional(),
      tagRole: z.string().optional(),
    }),
    output: AgentSchema,
  }),
  'agents.delete': defineRequest({
    input: z.object({ id: z.string() }),
    output: z.void(),
  }),
} as const;

export const AgentsEvents = {
  'agent.updated': defineEvent(AgentSchema),
  'agent.deleted': defineEvent(z.object({ id: z.string() })),
} as const;
