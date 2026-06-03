// src/shared/domain/__tests__/audit.test.ts
import { describe, it, expect } from 'vitest';
import {
  AuditEventSchema,
  AuditCategorySchema,
  categorizeAuditEvent,
} from '../audit';

describe('AuditEventSchema', () => {
  it('parses canonical event', () => {
    const e = AuditEventSchema.parse({
      id: 'ev-1',
      eventType: 'audit.access_denied',
      agentId: 'a1',
      agentName: 'Helper',
      tagRole: 'delegate',
      details: { path: 'C:\\secret', command: 'read_file' },
      timestamp: '2026-05-12T01:00:00Z',
      isRead: false,
    });
    expect(e.eventType).toBe('audit.access_denied');
    expect(e.details.path).toBe('C:\\secret');
  });

  it('defaults isRead and details', () => {
    const e = AuditEventSchema.parse({
      id: 'ev-2',
      eventType: 'audit.other',
      timestamp: '2026-05-12T01:00:00Z',
    });
    expect(e.isRead).toBe(false);
    expect(e.details).toEqual({});
  });
});

describe('AuditCategorySchema', () => {
  it('accepts all 5 macOS canonical values, rejects others', () => {
    for (const v of ['boundary_violation', 'access_denied', 'dialog_approval', 'approval', 'other']) {
      expect(AuditCategorySchema.parse(v)).toBe(v);
    }
    expect(() => AuditCategorySchema.parse('weird')).toThrow();
    expect(() => AuditCategorySchema.parse('boundary')).toThrow();
  });
});

describe('categorizeAuditEvent (AuditModels.swift:35-41)', () => {
  it('maps exact match audit.boundary_violation', () => {
    expect(categorizeAuditEvent('audit.boundary_violation')).toBe('boundary_violation');
  });

  it('does NOT match audit.boundary_violation_extra (must be exact, not prefix)', () => {
    expect(categorizeAuditEvent('audit.boundary_violation_extra')).toBe('other');
  });

  it('maps audit.access* (prefix) to access_denied', () => {
    expect(categorizeAuditEvent('audit.access_denied')).toBe('access_denied');
    expect(categorizeAuditEvent('audit.access_granted')).toBe('access_denied');
    expect(categorizeAuditEvent('audit.access')).toBe('access_denied');
    // 'audit.file_access' does NOT start with 'audit.access' — it starts with
    // 'audit.file'. The Swift prefix-rule is on 'audit.access', so this falls
    // into 'other' via the categorize function. (SecurityEventCenter row's
    // eventDescription switch DOES handle 'audit.file_access' as a display
    // synonym, but CATEGORY derivation is strict.)
    expect(categorizeAuditEvent('audit.file_access')).toBe('other');
  });

  it('maps dialog.approval* (prefix) to dialog_approval', () => {
    expect(categorizeAuditEvent('dialog.approval_request')).toBe('dialog_approval');
    expect(categorizeAuditEvent('dialog.approval_granted')).toBe('dialog_approval');
    expect(categorizeAuditEvent('dialog.approval')).toBe('dialog_approval');
  });

  it('maps approval.* (prefix) to approval', () => {
    expect(categorizeAuditEvent('approval.requested')).toBe('approval');
    expect(categorizeAuditEvent('approval.granted')).toBe('approval');
  });

  it('falls back to other for unmatched event types', () => {
    expect(categorizeAuditEvent('chat.message.created')).toBe('other');
    expect(categorizeAuditEvent('agent.updated')).toBe('other');
    expect(categorizeAuditEvent('unknown')).toBe('other');
  });
});
