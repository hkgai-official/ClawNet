import { z } from 'zod';
import { defineRequest, defineEvent } from './_common';
import { ConnectionStatusSchema } from '../domain/auth';

export const ConnectionRequests = {
  'connection.status': defineRequest({
    input: z.object({}),
    output: ConnectionStatusSchema,
  }),
  'connection.manualReconnect': defineRequest({
    input: z.object({}),
    output: z.void(),
  }),
} as const;

export const ConnectionEvents = {
  'connection.statusChanged': defineEvent(z.object({
    status: ConnectionStatusSchema,
    lastError: z.string().nullable(),
    reconnectAttempt: z.number().int().nonnegative(),
  })),
} as const;
