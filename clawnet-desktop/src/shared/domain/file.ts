import { z } from 'zod';

// 1:1 port of macOS `ClawNetAPI.FileInfo` from
// ClawNet/Networking/ClawNetAPI.swift:167-174. Wire keys are snake_case
// (`mime_type`, `thumbnail_url`); HttpClient's REST boundary converts them to
// camelCase on receive.
export const FileInfoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    size: z.number().int().nonnegative(),
    mimeType: z.string(),
    url: z.string().nullable().optional(),
    thumbnailUrl: z.string().nullable().optional(),
  })
  .passthrough();
export type FileInfo = z.infer<typeof FileInfoSchema>;
