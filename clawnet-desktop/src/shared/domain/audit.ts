import { z } from 'zod';

export const AuditEventSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  tagRole: z.string().optional(),
  details: z.record(z.string()).default({}),
  timestamp: z.string(),
  isRead: z.boolean().default(false),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

// AuditCategory — 1:1 port of macOS AuditModels.swift:43-71.
// Display labels (zh-Hans / en) live in i18n/audit.json. Icon and color
// are renderer-side concerns; the schema only enforces the enum.
export const AuditCategorySchema = z.enum([
  'boundary_violation',
  'access_denied',
  'dialog_approval',
  'approval',
  'other',
]);
export type AuditCategory = z.infer<typeof AuditCategorySchema>;

/**
 * 1:1 port of macOS AuditEvent.category (AuditModels.swift:35-41).
 * Order matters:
 *   1. exact match 'audit.boundary_violation' wins outright
 *   2. then prefix match 'audit.access'
 *   3. then prefix match 'dialog.approval'
 *   4. then prefix match 'approval.'
 *   5. else 'other'
 */
export function categorizeAuditEvent(eventType: string): AuditCategory {
  if (eventType === 'audit.boundary_violation') return 'boundary_violation';
  if (eventType.startsWith('audit.access')) return 'access_denied';
  if (eventType.startsWith('dialog.approval')) return 'dialog_approval';
  if (eventType.startsWith('approval.')) return 'approval';
  return 'other';
}
