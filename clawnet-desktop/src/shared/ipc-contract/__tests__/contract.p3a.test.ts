// src/shared/ipc-contract/__tests__/contract.p3a.test.ts
import { describe, it, expect } from 'vitest';
import { Requests } from '../index';

describe('P3A IPC contract', () => {
  it('registers tags.list / .create / .update / .delete', () => {
    expect(Requests['tags.list']).toBeDefined();
    expect(Requests['tags.create']).toBeDefined();
    expect(Requests['tags.update']).toBeDefined();
    expect(Requests['tags.delete']).toBeDefined();
  });

  it('tags.create input requires displayName', () => {
    const r = Requests['tags.create'].input.safeParse({});
    expect(r.success).toBe(false);
  });

  it('tags.create input accepts full body shape', () => {
    const r = Requests['tags.create'].input.safeParse({
      displayName: 'X',
      icon: 'star',
      color: '#FF0000',
      nodeAcl: { allowedPaths: ['C:\\x'], deniedPaths: [] },
    });
    expect(r.success).toBe(true);
  });

  it('tags.update input accepts id-only (empty patch)', () => {
    const r = Requests['tags.update'].input.safeParse({ id: 'tag-1' });
    expect(r.success).toBe(true);
  });

  it('contacts.updateTag input requires contactId and accepts null tagId', () => {
    const ok = Requests['contacts.updateTag'].input.safeParse({ contactId: 'c1', tagId: null });
    expect(ok.success).toBe(true);
    const assigned = Requests['contacts.updateTag'].input.safeParse({ contactId: 'c1', tagId: 'tag-1' });
    expect(assigned.success).toBe(true);
    const bad = Requests['contacts.updateTag'].input.safeParse({ tagId: null });
    expect(bad.success).toBe(false);
  });
});
