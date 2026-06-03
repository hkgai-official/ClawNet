// src/shared/domain/update-status.ts
//
// Win-port-only domain type. State machine for the auto-update flow.

import { z } from 'zod';

export const UpdateStateSchema = z.enum([
  'idle',
  'checking',
  'no-update',
  'available',
  'downloading',
  'downloaded',
  'error',
]);
export type UpdateState = z.infer<typeof UpdateStateSchema>;

export const UpdateStatusSchema = z.object({
  state: UpdateStateSchema,
  version: z.string().optional(),
  progressPercent: z.number().min(0).max(100).optional(),
  error: z.string().optional(),
});
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;
