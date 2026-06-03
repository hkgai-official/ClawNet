import { z } from 'zod';

// Mirrors macOS CommandPolicy.FileAccessMode (deny | scoped | full):
//   deny   → all file access denied (still subject to denied_paths first)
//   scoped → only paths under allowed_paths are permitted
//   full   → all paths permitted except those under denied_paths
export const FileAccessModeSchema = z.enum(['deny', 'scoped', 'full']);
export type FileAccessMode = z.infer<typeof FileAccessModeSchema>;

export const FileAccessSettingsSchema = z.object({
  mode: FileAccessModeSchema,
  allowedPaths: z.array(z.string()),
  deniedPaths: z.array(z.string()),
  defaultDeniedPaths: z.array(z.string()),
});
export type FileAccessSettings = z.infer<typeof FileAccessSettingsSchema>;
