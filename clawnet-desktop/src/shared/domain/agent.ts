import { z } from 'zod';

// Mirrors macOS AgentStatus (online | busy | offline | error).
export const AgentStatusSchema = z.enum(['online', 'busy', 'offline', 'error']);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

// Mirrors macOS ExecutionMode (local | cloud | hybrid).
export const ExecutionModeSchema = z.enum(['local', 'cloud', 'hybrid']);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

// Mirrors macOS AgentCapability (AgentModels.swift:180-221) — 10 canonical
// values. The pre-P2E Win port had 7 fabricated values (chat / file_read /
// file_write / web_browse / code_exec / screen / voice) that smoke missed
// because every live agent has `capabilities: []`. P2E fixes the drift and
// the reject-legacy tests in agent-governance.test.ts make it regression-proof.
export const AgentCapabilitySchema = z.enum([
  'file_processing',
  'web_search',
  'code_execution',
  'data_analysis',
  'scheduling',
  'email_access',
  'calendar_access',
  'document_editing',
  'image_generation',
  'translation',
]);
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

// ProactiveIntensity — AgentModels.swift:176-178
export const ProactiveIntensitySchema = z.enum(['off', 'low', 'medium', 'high']);
export type ProactiveIntensity = z.infer<typeof ProactiveIntensitySchema>;

// ProactiveRule — AgentModels.swift:281-287
export const ProactiveRuleSchema = z.object({
  id: z.string(),
  trigger: z.string(),
  condition: z.string(),
  action: z.string(),
  enabled: z.boolean(),
}).passthrough();
export type ProactiveRule = z.infer<typeof ProactiveRuleSchema>;

// AgentPermissions — AgentModels.swift:223-271. Wire format is the
// `permission_scope` dict (snake_case keys: can_read_files, …) — HttpClient
// converts to camelCase on receive. macOS provides `init(fromScope:)` and
// `toScope()` helpers (lines 244-270) that flatten the same fields.
export const AgentPermissionsSchema = z.object({
  canReadFiles: z.boolean(),
  canWriteFiles: z.boolean(),
  canAccessNetwork: z.boolean(),
  canExecuteCode: z.boolean(),
  canAccessCalendar: z.boolean(),
  canAccessEmail: z.boolean(),
  maxConcurrentTasks: z.number().int().positive(),
  requireApprovalFor: z.array(z.string()).nullable().optional(),
}).passthrough();
export type AgentPermissions = z.infer<typeof AgentPermissionsSchema>;

// Defaults — match macOS `AgentPermissions.init()` (lines 233-241).
export const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = {
  canReadFiles: true,
  canWriteFiles: false,
  canAccessNetwork: true,
  canExecuteCode: false,
  canAccessCalendar: false,
  canAccessEmail: false,
  maxConcurrentTasks: 3,
};

// AgentConfig — AgentModels.swift:146-166. Request body shape for
// createAgent + updateAgent. Wire-side body is built via the
// agentConfigToDict transformation (ClawNetAPI.swift:301-332).
export const AgentConfigSchema = z.object({
  displayName: z.string().min(1),
  description: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  capabilities: z.array(AgentCapabilitySchema),
  executionMode: ExecutionModeSchema,
  proactiveIntensity: ProactiveIntensitySchema,
  proactiveRules: z.array(ProactiveRuleSchema).nullable().optional(),
  permissions: AgentPermissionsSchema.nullable().optional(),
  modelProvider: z.string().nullable().optional(),
  modelName: z.string().nullable().optional(),
}).passthrough();
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const AgentSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  agentType: z.string(),
  status: AgentStatusSchema,
  executionMode: ExecutionModeSchema,
  capabilities: z.array(AgentCapabilitySchema),
  description: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  modelProvider: z.string().optional(),
  modelName: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  ownerId: z.string().optional(),
  /** Optional tag binding for tag-delegate agents (per macOS Agent.tagRole).
   *  Agents with `tagRole === 'delegate'` are tag-delegate workers and are
   *  filtered out of the main agent list (see AgentListView.swift:11-13). */
  tagId: z.string().nullable().optional(),
  tagRole: z.string().nullable().optional(),
}).passthrough();
export type Agent = z.infer<typeof AgentSchema>;
