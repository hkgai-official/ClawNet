// src/main/features/agents/__tests__/command-policy.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { CommandPolicy } from '../command-policy';
import { BookmarkStore } from '../../../store/bookmark-store';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { NodeAcl } from '../../../../shared/domain/tag';

let bookmarks: BookmarkStore;
let policy: CommandPolicy;
let tmp: string;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'cp-'));
  bookmarks = new BookmarkStore(join(tmp, 'fa.json'));
  await bookmarks.load();
  policy = new CommandPolicy({ bookmarks, serverSettings: null });
});

describe('CommandPolicy default-deny (path prefix)', () => {
  it('denies %WINDIR% / C:\\Windows always', () => {
    bookmarks.add({ path: 'C:\\Windows', label: 'try-bypass', grantedTo: ['all'] });
    const r = policy.check({ path: 'C:\\Windows\\system32\\notepad.exe', op: 'read', agentId: 'a1' });
    expect(r.decision).toBe('deny');
    expect(r.reason).toBe('default-denied');
  });

  it('denies %PROGRAMFILES%', () => {
    const r = policy.check({ path: 'C:\\Program Files\\App\\bin', op: 'read', agentId: 'a1' });
    expect(r.decision).toBe('deny');
  });

  it('denies %USERPROFILE%\\.ssh always', () => {
    bookmarks.add({ path: 'C:\\Users\\x\\.ssh', label: 'bad', grantedTo: ['all'] });
    const r = policy.check({ path: 'C:\\Users\\x\\.ssh\\id_rsa', op: 'read', agentId: 'a1' });
    expect(r.decision).toBe('deny');
  });
});

describe('CommandPolicy file-pattern deny', () => {
  it('denies *.pfx by extension', () => {
    bookmarks.add({ path: 'C:\\Users\\x\\Workspace', grantedTo: ['all'] });
    const r = policy.check({ path: 'C:\\Users\\x\\Workspace\\cert.pfx', op: 'read', agentId: 'a1' });
    expect(r.decision).toBe('deny');
    expect(r.reason).toBe('default-denied-pattern');
  });

  it('denies id_rsa* by filename prefix', () => {
    bookmarks.add({ path: 'C:\\Users\\x\\Workspace', grantedTo: ['all'] });
    const r = policy.check({ path: 'C:\\Users\\x\\Workspace\\id_rsa.bak', op: 'read', agentId: 'a1' });
    expect(r.decision).toBe('deny');
  });

  it('denies *.pem', () => {
    bookmarks.add({ path: 'C:\\Users\\x\\Workspace', grantedTo: ['all'] });
    const r = policy.check({ path: 'C:\\Users\\x\\Workspace\\private.pem', op: 'read', agentId: 'a1' });
    expect(r.decision).toBe('deny');
  });
});

describe('CommandPolicy allow when path is not default-denied and server has no scoped restriction', () => {
  it('allows arbitrary path under default user dir (no bookmark gate any more)', () => {
    // Bookmark gate was removed in `fix(policy): drop pending-consent
    // bookmark gate to match Swift CommandPolicy`. Server fileAccess
    // (set via Settings panel + the sync-from-server flow) is now the
    // sole gate. With server settings null, only default-deny prefixes
    // and pattern-deny apply.
    const r = policy.check({ path: 'C:\\Users\\x\\Workspace\\data.txt', op: 'read', agentId: 'a1' });
    expect(r.decision).toBe('allow');
  });
});

describe('CommandPolicy with server settings (3-mode: deny | scoped | full)', () => {
  it('mode=scoped: requires path under server allowedPaths', () => {
    bookmarks.add({ path: 'C:\\Users\\x\\Workspace', grantedTo: ['all'] });
    policy = new CommandPolicy({
      bookmarks,
      serverSettings: {
        mode: 'scoped',
        allowedPaths: ['C:\\Users\\x\\Other'],
        deniedPaths: [],
        defaultDeniedPaths: [],
      },
    });
    const r = policy.check({ path: 'C:\\Users\\x\\Workspace\\data.txt', op: 'read', agentId: 'a1' });
    expect(r.decision).toBe('deny');
    expect(r.reason).toBe('server-denied');
  });

  it('mode=scoped: allows path under server allowedPaths (combined with bookmark)', () => {
    bookmarks.add({ path: 'C:\\Users\\x\\Workspace', grantedTo: ['all'] });
    policy = new CommandPolicy({
      bookmarks,
      serverSettings: {
        mode: 'scoped',
        allowedPaths: ['C:\\Users\\x\\Workspace'],
        deniedPaths: [],
        defaultDeniedPaths: [],
      },
    });
    const r = policy.check({ path: 'C:\\Users\\x\\Workspace\\data.txt', op: 'read', agentId: 'a1' });
    expect(r.decision).toBe('allow');
  });

  it('mode=deny: denies everything, even with bookmark + matching allowedPaths', () => {
    bookmarks.add({ path: 'C:\\Users\\x\\Workspace', grantedTo: ['all'] });
    policy = new CommandPolicy({
      bookmarks,
      serverSettings: {
        mode: 'deny',
        allowedPaths: ['C:\\Users\\x\\Workspace'],
        deniedPaths: [],
        defaultDeniedPaths: [],
      },
    });
    const r = policy.check({ path: 'C:\\Users\\x\\Workspace\\data.txt', op: 'read', agentId: 'a1' });
    expect(r.decision).toBe('deny');
    expect(r.reason).toBe('server-denied');
  });

  it('mode=full: allows anything not in deniedPaths (no allowedPaths gate)', () => {
    bookmarks.add({ path: 'C:\\Users\\x\\Workspace', grantedTo: ['all'] });
    policy = new CommandPolicy({
      bookmarks,
      serverSettings: {
        mode: 'full',
        allowedPaths: [],
        deniedPaths: [],
        defaultDeniedPaths: [],
      },
    });
    const r = policy.check({ path: 'C:\\Users\\x\\Workspace\\data.txt', op: 'read', agentId: 'a1' });
    expect(r.decision).toBe('allow');
  });

  it('deniedPaths take precedence in every mode', () => {
    bookmarks.add({ path: 'C:\\Users\\x\\Workspace', grantedTo: ['all'] });
    policy = new CommandPolicy({
      bookmarks,
      serverSettings: {
        mode: 'full',
        allowedPaths: [],
        deniedPaths: ['C:\\Users\\x\\Workspace\\Secret'],
        defaultDeniedPaths: [],
      },
    });
    const r = policy.check({ path: 'C:\\Users\\x\\Workspace\\Secret\\file.txt', op: 'read', agentId: 'a1' });
    expect(r.decision).toBe('deny');
    expect(r.reason).toBe('server-denied');
  });
});

describe('CommandPolicy path-traversal protection', () => {
  // Bookmark gate was removed (server fileAccess is now the sole gate),
  // so path-traversal protection comes from the server's `scoped` mode:
  // `Workspace\..\Secret` normalises to `Secret`, which is OUTSIDE the
  // single allowedPath, so server-side gate rejects.
  it('rejects paths that would resolve outside the allowed root via .. (via server scoped mode)', () => {
    policy = new CommandPolicy({
      bookmarks,
      serverSettings: {
        mode: 'scoped',
        allowedPaths: ['C:\\Users\\x\\Workspace'],
        deniedPaths: [],
        defaultDeniedPaths: [],
      },
    });
    const r = policy.check({
      path: 'C:\\Users\\x\\Workspace\\..\\Secret\\file.txt',
      op: 'read', agentId: 'a1',
    });
    expect(r.decision).toBe('deny');
    expect(r.reason).toBe('server-denied');
  });
});

// Minimal mock bookmark store — always allows, so we isolate the tag-ACL layer.
function permissiveBookmarks(): BookmarkStore {
  return { isAllowed: () => true } as unknown as BookmarkStore;
}

describe('CommandPolicy.checkWithTagAcl (CommandPolicy.swift:96-141)', () => {
  it('returns global deny verbatim when global policy says deny', () => {
    const p = new CommandPolicy({ bookmarks: permissiveBookmarks(), serverSettings: { mode: 'deny', allowedPaths: [], deniedPaths: [], defaultDeniedPaths: [] } });
    const acl: NodeAcl = { allowedPaths: ['C:\\Users\\alice\\Workspace'], deniedPaths: [] };
    const r = p.checkWithTagAcl({ path: 'C:\\Users\\alice\\Workspace\\notes.txt', op: 'read', agentId: 'a1' }, acl);
    expect(r.decision).toBe('deny');
    expect(r.reason).toBe('server-denied');
  });

  it('rejects writes when accessMode is "ro"', () => {
    const p = new CommandPolicy({ bookmarks: permissiveBookmarks(), serverSettings: { mode: 'full', allowedPaths: [], deniedPaths: [], defaultDeniedPaths: [] } });
    const acl: NodeAcl = { allowedPaths: ['C:\\Users\\alice\\Workspace'], deniedPaths: [], accessMode: 'ro' };
    const r = p.checkWithTagAcl({ path: 'C:\\Users\\alice\\Workspace\\notes.txt', op: 'write', agentId: 'a1' }, acl);
    expect(r.decision).toBe('deny');
    expect(r.reason).toBe('tag-acl-read-only');
  });

  it('permits writes when accessMode is "rw"', () => {
    const p = new CommandPolicy({ bookmarks: permissiveBookmarks(), serverSettings: { mode: 'full', allowedPaths: [], deniedPaths: [], defaultDeniedPaths: [] } });
    const acl: NodeAcl = { allowedPaths: ['C:\\Users\\alice\\Workspace'], deniedPaths: [], accessMode: 'rw' };
    const r = p.checkWithTagAcl({ path: 'C:\\Users\\alice\\Workspace\\notes.txt', op: 'write', agentId: 'a1' }, acl);
    expect(r.decision).toBe('allow');
  });

  it('denies when path matches a tag deniedPaths entry', () => {
    const p = new CommandPolicy({ bookmarks: permissiveBookmarks(), serverSettings: { mode: 'full', allowedPaths: [], deniedPaths: [], defaultDeniedPaths: [] } });
    const acl: NodeAcl = { allowedPaths: ['C:\\Users\\alice'], deniedPaths: ['C:\\Users\\alice\\Secrets'] };
    const r = p.checkWithTagAcl({ path: 'C:\\Users\\alice\\Secrets\\token.txt', op: 'read', agentId: 'a1' }, acl);
    expect(r.decision).toBe('deny');
    expect(r.reason).toBe('tag-acl-denied');
  });

  it('denies when tag allowedPaths is empty (explicit empty intent)', () => {
    const p = new CommandPolicy({ bookmarks: permissiveBookmarks(), serverSettings: { mode: 'full', allowedPaths: [], deniedPaths: [], defaultDeniedPaths: [] } });
    const acl: NodeAcl = { allowedPaths: [], deniedPaths: [] };
    const r = p.checkWithTagAcl({ path: 'C:\\Users\\alice\\notes.txt', op: 'read', agentId: 'a1' }, acl);
    expect(r.decision).toBe('deny');
    expect(r.reason).toBe('tag-acl-no-allowed-paths');
  });

  it('allows when path is under a tag allowedPaths directory prefix', () => {
    const p = new CommandPolicy({ bookmarks: permissiveBookmarks(), serverSettings: { mode: 'full', allowedPaths: [], deniedPaths: [], defaultDeniedPaths: [] } });
    const acl: NodeAcl = { allowedPaths: ['C:\\Users\\alice\\Workspace'], deniedPaths: [] };
    const r = p.checkWithTagAcl({ path: 'C:\\Users\\alice\\Workspace\\Sub\\Deep\\file.txt', op: 'read', agentId: 'a1' }, acl);
    expect(r.decision).toBe('allow');
  });

  it('denies when path is outside all tag allowedPaths', () => {
    const p = new CommandPolicy({ bookmarks: permissiveBookmarks(), serverSettings: { mode: 'full', allowedPaths: [], deniedPaths: [], defaultDeniedPaths: [] } });
    const acl: NodeAcl = { allowedPaths: ['C:\\Users\\alice\\Workspace'], deniedPaths: [] };
    const r = p.checkWithTagAcl({ path: 'C:\\Other\\place.txt', op: 'read', agentId: 'a1' }, acl);
    expect(r.decision).toBe('deny');
    expect(r.reason).toBe('tag-acl-not-allowed');
  });

  it('global allow still required: global mode=scoped without match → server-denied (global wins)', () => {
    const p = new CommandPolicy({ bookmarks: permissiveBookmarks(), serverSettings: { mode: 'scoped', allowedPaths: ['C:\\Users\\alice'], deniedPaths: [], defaultDeniedPaths: [] } });
    const acl: NodeAcl = { allowedPaths: ['C:\\Other'], deniedPaths: [] };
    const r = p.checkWithTagAcl({ path: 'C:\\Other\\file.txt', op: 'read', agentId: 'a1' }, acl);
    expect(r.decision).toBe('deny');
    expect(r.reason).toBe('server-denied');
  });
});
