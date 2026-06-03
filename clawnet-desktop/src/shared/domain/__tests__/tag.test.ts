// src/shared/domain/__tests__/tag.test.ts
import { describe, it, expect } from 'vitest';
import { TagSchema, NodeAclSchema, NodeAclAccessModeSchema } from '../tag';

describe('NodeAclSchema (TagModels.swift:19-23)', () => {
  it('applies defaults for empty allowed/denied arrays', () => {
    const a = NodeAclSchema.parse({});
    expect(a.allowedPaths).toEqual([]);
    expect(a.deniedPaths).toEqual([]);
    expect(a.accessMode).toBeUndefined();
  });

  it('parses canonical full payload', () => {
    const a = NodeAclSchema.parse({
      allowedPaths: ['C:\\Users\\alice\\Workspace'],
      deniedPaths: ['C:\\Windows'],
      accessMode: 'rw',
    });
    expect(a.accessMode).toBe('rw');
  });

  it('accepts ro / rw and rejects anything else (4th-drift discipline)', () => {
    expect(NodeAclAccessModeSchema.parse('rw')).toBe('rw');
    expect(NodeAclAccessModeSchema.parse('ro')).toBe('ro');
    expect(() => NodeAclAccessModeSchema.parse('admin')).toThrow();
    expect(() => NodeAclAccessModeSchema.parse('read')).toThrow();
    expect(() => NodeAclAccessModeSchema.parse('write')).toThrow();
  });

  it('treats null accessMode as "default" (parses, optional)', () => {
    const a = NodeAclSchema.parse({ accessMode: null });
    expect(a.accessMode).toBeNull();
  });
});

describe('TagSchema (TagModels.swift:5-17)', () => {
  it('parses canonical tag payload (shape mirrors Swift)', () => {
    const t = TagSchema.parse({
      id: 'tag-1',
      ownerId: 'u1',
      name: 'workspace',
      displayName: 'Workspace',
      icon: null,
      color: '#7A5CFF',
      isDefault: true,
      isMain: false,
      workspaceId: 'ws-1',
      nodeAcl: { allowedPaths: ['C:\\Users\\alice\\Workspace'], deniedPaths: [] },
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(t.id).toBe('tag-1');
    expect(t.isDefault).toBe(true);
    expect(t.nodeAcl.allowedPaths).toEqual(['C:\\Users\\alice\\Workspace']);
  });

  it('accepts isMain omitted', () => {
    const t = TagSchema.parse({
      id: 'tag-2', ownerId: 'u1', name: 'team', displayName: 'Team',
      isDefault: false, workspaceId: 'ws-1',
      nodeAcl: { allowedPaths: [], deniedPaths: [] },
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    });
    expect(t.isMain).toBeUndefined();
  });

  it('requires required fields', () => {
    expect(() => TagSchema.parse({ id: 'x' })).toThrow();
  });
});
