import { z } from 'zod';
import { defineRequest, defineEvent } from './_common';
import { DiscoveryTaskSchema } from '../domain/discovery';

export const DiscoveryRequests = {
  'discovery.list': defineRequest({
    input: z.object({ status: z.string().optional() }),
    output: z.array(DiscoveryTaskSchema),
  }),
  'discovery.get': defineRequest({
    input: z.object({ id: z.string() }),
    output: DiscoveryTaskSchema,
  }),
  'discovery.getByConv': defineRequest({
    input: z.object({ conversationId: z.string() }),
    output: z.union([DiscoveryTaskSchema, z.null()]),
  }),
  'discovery.confirm': defineRequest({
    input: z.object({
      id: z.string(),
      queries: z.array(z.record(z.unknown())).optional(),
    }),
    output: DiscoveryTaskSchema,
  }),
  'discovery.cancel': defineRequest({
    input: z.object({
      id: z.string(),
      reason: z.string().optional(),
    }),
    output: DiscoveryTaskSchema,
  }),
} as const;

export const DiscoveryEvents = {
  'discovery.statusChanged': defineEvent(DiscoveryTaskSchema),
} as const;
