// src/shared/ipc-contract/__tests__/contract.p2e.test.ts
import { describe, it, expect } from 'vitest';
import { Requests } from '../index';

describe('P2E IPC contract — agent CRUD', () => {
  it('agents.create requires AgentConfig + optional tag refs', () => {
    expect(Requests['agents.create'].input.safeParse({
      config: {
        displayName: 'B',
        capabilities: ['web_search'],
        executionMode: 'cloud',
        proactiveIntensity: 'medium',
      },
    }).success).toBe(true);

    expect(Requests['agents.create'].input.safeParse({
      config: {
        displayName: 'B',
        capabilities: ['web_search'],
        executionMode: 'cloud',
        proactiveIntensity: 'medium',
      },
      tagId: 't1', tagRole: 'delegate',
    }).success).toBe(true);

    // Legacy capability values should be rejected here too via composed schema:
    expect(Requests['agents.create'].input.safeParse({
      config: {
        displayName: 'B',
        capabilities: ['file_read'],
        executionMode: 'cloud',
        proactiveIntensity: 'medium',
      },
    }).success).toBe(false);
  });

  it('agents.update requires id + AgentConfig', () => {
    expect(Requests['agents.update'].input.safeParse({
      id: 'a1',
      config: {
        displayName: 'X', capabilities: [], executionMode: 'hybrid', proactiveIntensity: 'off',
      },
    }).success).toBe(true);
  });

  it('agents.delete requires id', () => {
    expect(Requests['agents.delete'].input.safeParse({ id: 'a1' }).success).toBe(true);
  });
});
