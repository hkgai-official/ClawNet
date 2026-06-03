import { z } from 'zod';
import { defineRequest, defineEvent } from './_common';
import { AuditEventSchema } from '../domain/audit';

export const AuditRequests = {
  'audit.events.list': defineRequest({
    input: z.object({
      limit: z.number().int().positive().max(500).default(50),
      offset: z.number().int().nonnegative().default(0),
    }),
    output: z.array(AuditEventSchema),
  }),
} as const;

export const AuditEvents = {
  'audit.event': defineEvent(AuditEventSchema),
} as const;
