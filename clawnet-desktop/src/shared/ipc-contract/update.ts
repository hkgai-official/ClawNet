// src/shared/ipc-contract/update.ts
import { z } from 'zod';
import { defineRequest, defineEvent } from './_common';
import { UpdateStatusSchema } from '../domain/update-status';

export const UpdateRequests = {
  'app.checkForUpdates': defineRequest({
    input: z.object({}),
    output: UpdateStatusSchema,
  }),
  'app.quitAndInstall': defineRequest({
    input: z.object({}),
    output: z.void(),
  }),
} as const;

export const UpdateEvents = {
  'app.updateStatus': defineEvent(UpdateStatusSchema),
} as const;
