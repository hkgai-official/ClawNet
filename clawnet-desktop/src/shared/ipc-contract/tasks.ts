import { z } from 'zod';
import { defineRequest, defineEvent } from './_common';
import { ServerTaskSchema, ApprovalDecisionSchema, ExecutionLogSchema } from '../domain/task';

export const TasksRequests = {
  'tasks.create': defineRequest({
    input: z.object({
      agentId: z.string(),
      conversationId: z.string(),
      description: z.string().min(1),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    }),
    output: ServerTaskSchema,
  }),
  'tasks.get': defineRequest({
    input: z.object({ id: z.string() }),
    output: ServerTaskSchema,
  }),
  'tasks.approve': defineRequest({
    input: z.object({
      id: z.string(),
      decision: ApprovalDecisionSchema,
      modifications: z.string().optional(),
    }),
    output: ServerTaskSchema,
  }),
  'tasks.cancel': defineRequest({
    input: z.object({ id: z.string() }),
    output: ServerTaskSchema,
  }),
  'tasks.getLogs': defineRequest({
    input: z.object({ id: z.string() }),
    output: z.array(ExecutionLogSchema),
  }),
} as const;

export const TasksEvents = {
  'task.statusChanged': defineEvent(ServerTaskSchema),
  'task.log.appended': defineEvent(z.object({
    taskId: z.string(),
    log: ExecutionLogSchema,
  })),
} as const;
