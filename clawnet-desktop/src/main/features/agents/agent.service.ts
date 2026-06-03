import { z } from 'zod';
import type { HttpClient } from '../../network/http-client';
import { AgentSchema, type Agent, type AgentConfig } from '../../../shared/domain/agent';

const AgentResponseSchema = z.object({ data: AgentSchema });
const AgentListResponseSchema = z.object({ data: z.array(AgentSchema) });

export interface AgentServiceOptions {
  http: HttpClient;
}

interface CrudOptions {
  tagId?: string;
  tagRole?: string;
}

// Mirrors macOS ClawNetAPI.swift:301-332 `agentConfigToDict`. Top-level keys
// are camelCase here — HttpClient converts to snake_case at the REST boundary.
// Nested `permission_scope` + `proactive_rules` items use pre-snaked keys
// because that's what macOS sends, and the converter is idempotent on
// already-snake_case names (no uppercase letters to transform).
function buildConfigDict(config: AgentConfig, isCreate: boolean): Record<string, unknown> {
  const dict: Record<string, unknown> = {
    displayName: config.displayName,
    capabilities: config.capabilities,
    executionMode: config.executionMode,
    proactiveIntensity: config.proactiveIntensity,
  };
  if (config.description !== undefined && config.description !== null) dict.description = config.description;
  if (config.avatarUrl !== undefined && config.avatarUrl !== null) dict.avatarUrl = config.avatarUrl;
  if (config.systemPrompt !== undefined && config.systemPrompt !== null) dict.systemPrompt = config.systemPrompt;
  if (config.proactiveRules && config.proactiveRules.length > 0) {
    dict.proactiveRules = config.proactiveRules.map((r) => ({
      id: r.id,
      trigger: r.trigger,
      condition: r.condition,
      action: r.action,
      enabled: r.enabled,
    }));
  }
  if (config.permissions) {
    // permission_scope dict matches macOS `AgentPermissions.toScope()` (lines 256-269).
    const p = config.permissions;
    const scope: Record<string, unknown> = {
      can_read_files: p.canReadFiles,
      can_write_files: p.canWriteFiles,
      can_access_network: p.canAccessNetwork,
      can_execute_code: p.canExecuteCode,
      can_access_calendar: p.canAccessCalendar,
      can_access_email: p.canAccessEmail,
      max_concurrent_tasks: p.maxConcurrentTasks,
    };
    if (p.requireApprovalFor) scope.require_approval_for = p.requireApprovalFor;
    dict.permission_scope = scope;
  }
  if (config.modelProvider || config.modelName) {
    const modelCfg: Record<string, unknown> = {};
    if (config.modelProvider) modelCfg.provider = config.modelProvider;
    if (config.modelName) modelCfg.model = config.modelName;
    dict.modelConfigData = modelCfg;
  }
  if (isCreate) {
    dict.agentType = 'general';
    dict.interactionMode = 'background';
  }
  return dict;
}

export class AgentService {
  constructor(private readonly opts: AgentServiceOptions) {}

  async list(): Promise<Agent[]> {
    const raw = await this.opts.http.getJson<unknown>('/api/v1/agents');
    return AgentListResponseSchema.parse(raw).data;
  }

  async get(id: string): Promise<Agent> {
    const raw = await this.opts.http.getJson<unknown>(`/api/v1/agents/${id}`);
    return AgentResponseSchema.parse(raw).data;
  }

  async contactable(): Promise<Agent[]> {
    const raw = await this.opts.http.getJson<unknown>('/api/v1/agents/contactable');
    return AgentListResponseSchema.parse(raw).data;
  }

  async createAgent(config: AgentConfig, opts?: CrudOptions): Promise<Agent> {
    const body = buildConfigDict(config, true);
    if (opts?.tagId) body.tagId = opts.tagId;
    if (opts?.tagRole) body.tagRole = opts.tagRole;
    const raw = await this.opts.http.postJson<unknown>('/api/v1/agents', body);
    return AgentResponseSchema.parse(raw).data;
  }

  async updateAgent(id: string, config: AgentConfig, opts?: CrudOptions): Promise<Agent> {
    const body = buildConfigDict(config, false);
    if (opts?.tagId) body.tagId = opts.tagId;
    if (opts?.tagRole) body.tagRole = opts.tagRole;
    const raw = await this.opts.http.patchJson<unknown>(
      `/api/v1/agents/${encodeURIComponent(id)}`,
      body,
    );
    return AgentResponseSchema.parse(raw).data;
  }

  async deleteAgent(id: string): Promise<void> {
    await this.opts.http.deleteJson(`/api/v1/agents/${encodeURIComponent(id)}`);
  }
}
