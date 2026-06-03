import { z } from 'zod';
import { defineRequest, defineEvent } from './_common';
import { FileAccessSettingsSchema } from '../domain/file-access';

export const FileAccessRequests = {
  'settings.fileAccess.get': defineRequest({
    input: z.object({}),
    output: FileAccessSettingsSchema,
  }),
  'settings.fileAccess.update': defineRequest({
    input: z.object({
      mode: z.enum(['deny', 'scoped', 'full']),
      allowedPaths: z.array(z.string()),
      deniedPaths: z.array(z.string()),
    }),
    output: z.void(),
  }),
  'settings.fileAccess.browsePath': defineRequest({
    input: z.object({}),
    output: z.string().nullable(),
  }),
} as const;

export const FileAccessEvents = {
  'fileAccess.changed': defineEvent(FileAccessSettingsSchema),
} as const;
