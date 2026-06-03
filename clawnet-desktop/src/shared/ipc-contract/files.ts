import { z } from 'zod';
import { defineRequest } from './_common';
import { FileInfoSchema } from '../domain/file';

// P2F: global file search (ClawNetAPI.swift:657-661). Lives in its own
// namespace because the existing `chat.*` channels are conversation-scoped
// and the upload/download surface is internal to the chat send pipeline —
// `files.search` is the first user-facing top-level file channel.
export const FileRequests = {
  'files.search': defineRequest({
    input: z.object({ query: z.string() }),
    output: z.array(FileInfoSchema),
  }),
} as const;

export const FileEvents = {} as const;
