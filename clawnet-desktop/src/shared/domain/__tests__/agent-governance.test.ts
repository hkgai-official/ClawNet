// src/shared/domain/__tests__/agent-governance.test.ts
import { describe, it, expect } from 'vitest';
import {
  AgentSchema, AgentStatusSchema, AgentCapabilitySchema,
  ProactiveIntensitySchema, ProactiveRuleSchema, AgentPermissionsSchema,
  AgentConfigSchema, DEFAULT_AGENT_PERMISSIONS,
} from '../agent';
import { DialogSessionSchema, DialogStatusSchema } from '../dialog';
import { DiscoveryTaskSchema } from '../discovery';
import { ServerTaskSchema, ApprovalRequestSchema } from '../task';
import { AuditEventSchema } from '../audit';
import { FileAccessSettingsSchema, FileAccessModeSchema } from '../file-access';

describe('AgentSchema', () => {
  it('parses minimal agent', () => {
    const a = AgentSchema.parse({
      id: 'a1', displayName: 'Helper', agentType: 'general',
      status: 'online', executionMode: 'hybrid',
      capabilities: [], createdAt: '2026-05-01T00:00:00Z',
    });
    expect(a.id).toBe('a1');
  });
  it('AgentStatusSchema rejects unknown', () => {
    expect(() => AgentStatusSchema.parse('unknown')).toThrow();
    expect(() => AgentStatusSchema.parse('active')).toThrow();
    expect(AgentStatusSchema.parse('online')).toBe('online');
    expect(AgentStatusSchema.parse('offline')).toBe('offline');
  });
  it('accepts null for nullable string fields (avatarUrl / systemPrompt / description)', () => {
    const a = AgentSchema.parse({
      id: 'a1', displayName: 'Helper', agentType: 'general',
      status: 'online', executionMode: 'hybrid', capabilities: [],
      avatarUrl: null, systemPrompt: null, description: null,
      createdAt: '2026-05-01T00:00:00Z',
    });
    expect(a.avatarUrl).toBeNull();
    expect(a.systemPrompt).toBeNull();
    expect(a.description).toBeNull();
  });
});

describe('DialogSessionSchema', () => {
  it('parses canonical session (shape mirrors macOS AgentModels.swift:289-307)', () => {
    const d = DialogSessionSchema.parse({
      id: 'd1',
      initiatorAgent: { id: 'a1', displayName: 'Init Agent' },
      responderAgent: { id: 'a2', displayName: 'Resp Agent' },
      initiatorOwner: { id: 'u1', displayName: 'Alice' },
      responderOwner: { id: 'u2', displayName: 'Bob' },
      topic: 'plan',
      status: 'pending_approval',
      maxRounds: 5,
      currentRound: 0,
      conversationId: 'c1',
      createdAt: '2026-05-01T00:00:00Z',
    });
    expect(d.status).toBe('pending_approval');
    expect(d.initiatorAgent.displayName).toBe('Init Agent');
    expect(d.responderOwner.displayName).toBe('Bob');
  });
  it('DialogStatusSchema accepts macOS canonical values and rejects invented/unknown', () => {
    expect(() => DialogStatusSchema.parse('weird')).toThrow();
    // 'approved' / 'pending' / 'in_progress' etc. were P1E inventions — must reject.
    expect(() => DialogStatusSchema.parse('approved')).toThrow();
    expect(() => DialogStatusSchema.parse('pending')).toThrow();
    expect(() => DialogStatusSchema.parse('in_progress')).toThrow();
    for (const s of ['pending_approval', 'active', 'paused', 'completed', 'terminated']) {
      expect(DialogStatusSchema.parse(s)).toBe(s);
    }
  });
});

describe('DiscoveryTaskSchema', () => {
  it('parses canonical task (shape mirrors macOS AgentModels.swift:401-419)', () => {
    const t = DiscoveryTaskSchema.parse({
      id: 't1',
      sourceConversationId: 'c1',
      initiatorAgentId: 'a1',
      initiatorOwnerId: 'u1',
      status: 'pending_confirmation',
      originalIntent: 'find news about ClawNet',
      maxHops: 3,
      currentHopCount: 0,
      maxConcurrent: 1,
      pendingQueries: [],
      completedResults: [],
      activeSessions: [],
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(t.status).toBe('pending_confirmation');
    expect(t.originalIntent).toBe('find news about ClawNet');
    expect(t.sourceConversationId).toBe('c1');
  });
});

describe('ServerTaskSchema', () => {
  it('parses canonical task', () => {
    const t = ServerTaskSchema.parse({
      id: 'st1', agentId: 'a1', conversationId: 'c1',
      description: 'summarize', priority: 'normal',
      status: 'pending', createdAt: '2026-05-01T00:00:00Z',
    });
    expect(t.priority).toBe('normal');
  });
  it('ApprovalRequestSchema accepts decision', () => {
    const v = ApprovalRequestSchema.parse({ decision: 'approve' });
    expect(v.decision).toBe('approve');
  });
});

describe('AuditEventSchema', () => {
  it('parses minimal audit event', () => {
    const e = AuditEventSchema.parse({
      id: 'e1', eventType: 'audit.something',
      timestamp: '2026-05-01T00:00:00Z', isRead: false,
      details: {},
    });
    expect(e.eventType).toBe('audit.something');
  });
});

describe('AgentCapabilitySchema (FIX — AgentModels.swift:180-221, 4th schema drift)', () => {
  it('accepts every canonical macOS value', () => {
    const canonical = [
      'file_processing', 'web_search', 'code_execution', 'data_analysis',
      'scheduling', 'email_access', 'calendar_access',
      'document_editing', 'image_generation', 'translation',
    ];
    for (const v of canonical) {
      expect(AgentCapabilitySchema.parse(v)).toBe(v);
    }
  });

  it('rejects every legacy/fabricated value from pre-P2E Win port', () => {
    const legacy = ['chat', 'file_read', 'file_write', 'web_browse', 'code_exec', 'screen', 'voice'];
    for (const v of legacy) {
      expect(() => AgentCapabilitySchema.parse(v)).toThrow();
    }
  });

  it('rejects unknown strings', () => {
    expect(() => AgentCapabilitySchema.parse('superpower')).toThrow();
  });
});

describe('ProactiveIntensitySchema (AgentModels.swift:176-178)', () => {
  it('accepts off/low/medium/high; rejects others', () => {
    for (const v of ['off', 'low', 'medium', 'high']) {
      expect(ProactiveIntensitySchema.parse(v)).toBe(v);
    }
    expect(() => ProactiveIntensitySchema.parse('extreme')).toThrow();
  });
});

describe('ProactiveRuleSchema (AgentModels.swift:281-287)', () => {
  it('parses canonical rule', () => {
    const r = ProactiveRuleSchema.parse({
      id: 'r1', trigger: 'morning', condition: 'is_weekday', action: 'summarize_inbox', enabled: true,
    });
    expect(r.enabled).toBe(true);
  });
  it('requires all fields', () => {
    expect(() => ProactiveRuleSchema.parse({ id: 'r1', trigger: 'x' })).toThrow();
  });
});

describe('AgentPermissionsSchema (AgentModels.swift:223-271)', () => {
  it('parses canonical permission set', () => {
    const p = AgentPermissionsSchema.parse({
      canReadFiles: true, canWriteFiles: false, canAccessNetwork: true,
      canExecuteCode: false, canAccessCalendar: false, canAccessEmail: false,
      maxConcurrentTasks: 3,
    });
    expect(p.maxConcurrentTasks).toBe(3);
    expect(p.requireApprovalFor).toBeUndefined();
  });
  it('accepts optional requireApprovalFor array', () => {
    const p = AgentPermissionsSchema.parse({
      canReadFiles: true, canWriteFiles: true, canAccessNetwork: true,
      canExecuteCode: true, canAccessCalendar: true, canAccessEmail: true,
      maxConcurrentTasks: 5,
      requireApprovalFor: ['file_write', 'code_execution'],
    });
    expect(p.requireApprovalFor).toEqual(['file_write', 'code_execution']);
  });
  it('rejects negative maxConcurrentTasks', () => {
    expect(() => AgentPermissionsSchema.parse({
      canReadFiles: true, canWriteFiles: false, canAccessNetwork: true,
      canExecuteCode: false, canAccessCalendar: false, canAccessEmail: false,
      maxConcurrentTasks: -1,
    })).toThrow();
  });
});

describe('AgentConfigSchema (AgentModels.swift:146-166)', () => {
  it('parses minimal config (just required fields)', () => {
    const c = AgentConfigSchema.parse({
      displayName: 'New Bot',
      capabilities: [],
      executionMode: 'hybrid',
      proactiveIntensity: 'medium',
    });
    expect(c.displayName).toBe('New Bot');
  });

  it('parses full config including nested permissions + proactive rules', () => {
    const c = AgentConfigSchema.parse({
      displayName: 'Powered Bot',
      description: 'a description',
      avatarUrl: 'https://x/a.png',
      systemPrompt: 'You are helpful',
      capabilities: ['file_processing', 'web_search'],
      executionMode: 'cloud',
      proactiveIntensity: 'high',
      proactiveRules: [{ id: 'r1', trigger: 'morning', condition: 'always', action: 'greet', enabled: true }],
      permissions: DEFAULT_AGENT_PERMISSIONS,
      modelProvider: 'anthropic',
      modelName: 'claude-opus-4-7',
    });
    expect(c.capabilities).toEqual(['file_processing', 'web_search']);
    expect(c.permissions?.canReadFiles).toBe(true);
  });

  it('rejects legacy capability values', () => {
    expect(() => AgentConfigSchema.parse({
      displayName: 'B', capabilities: ['file_read'], executionMode: 'hybrid', proactiveIntensity: 'low',
    })).toThrow();
  });
});

describe('FileAccessSettingsSchema', () => {
  it('parses canonical settings (scoped is the real-server default)', () => {
    const s = FileAccessSettingsSchema.parse({
      mode: 'scoped',
      allowedPaths: ['C:\\Users\\x\\Workspace'],
      deniedPaths: ['C:\\Windows'],
      defaultDeniedPaths: ['C:\\Windows'],
    });
    expect(s.mode).toBe('scoped');
  });
  it('FileAccessModeSchema accepts deny / scoped / full and rejects legacy / unknown', () => {
    expect(() => FileAccessModeSchema.parse('chaos')).toThrow();
    expect(() => FileAccessModeSchema.parse('allowList')).toThrow();
    expect(() => FileAccessModeSchema.parse('denyList')).toThrow();
    expect(FileAccessModeSchema.parse('deny')).toBe('deny');
    expect(FileAccessModeSchema.parse('scoped')).toBe('scoped');
    expect(FileAccessModeSchema.parse('full')).toBe('full');
  });
});
