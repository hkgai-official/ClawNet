import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFileStatHandler } from '../file-stat';

const allowPolicy = { check: () => ({ decision: 'allow' as const, reason: '' }) };
const denyPolicy = { check: () => ({ decision: 'deny' as const, reason: 'no access' }) };

function ctx(paramsJSON: string) {
  return { invokeId: 'i', paramsJSON };
}

describe('file.stat handler', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'stat-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('returns error when path is missing', async () => {
    const handler = makeFileStatHandler({ policy: allowPolicy });
    const result = await handler(ctx(JSON.stringify({})));
    expect(JSON.parse(result)).toEqual({ error: 'missing path' });
  });

  it('returns error when params JSON invalid', async () => {
    const handler = makeFileStatHandler({ policy: allowPolicy });
    const result = await handler(ctx('not-json'));
    expect(JSON.parse(result).error).toBeDefined();
  });

  it('returns policy denial reason on read deny', async () => {
    const handler = makeFileStatHandler({ policy: denyPolicy });
    const r = await handler(ctx(JSON.stringify({ path: join(tmp, 'a') })));
    expect(JSON.parse(r)).toEqual({ error: 'no access' });
  });

  it('returns NOT_FOUND when path does not exist', async () => {
    const handler = makeFileStatHandler({ policy: allowPolicy });
    const target = join(tmp, 'missing.txt');
    const r = await handler(ctx(JSON.stringify({ path: target })));
    expect(JSON.parse(r)).toEqual({ error: `NOT_FOUND: ${target}` });
  });

  it('returns type=file and stat fields for a regular file', async () => {
    const handler = makeFileStatHandler({ policy: allowPolicy });
    const target = join(tmp, 'a.txt');
    await writeFile(target, 'hello');
    const r = await handler(ctx(JSON.stringify({ path: target })));
    const parsed = JSON.parse(r);
    expect(parsed.path).toBe(target);
    expect(parsed.type).toBe('file');
    expect(parsed.size).toBe(5);
    expect(typeof parsed.permissions).toBe('number');
    expect(parsed.readable).toBe(true);
    expect(parsed.writable).toBe(true);
    expect(typeof parsed.modifiedAt).toBe('number');
    expect(parsed.modifiedAt).toBeGreaterThan(0);
  });

  it('returns type=directory for a directory', async () => {
    const handler = makeFileStatHandler({ policy: allowPolicy });
    const target = join(tmp, 'subdir');
    await mkdir(target);
    const r = await handler(ctx(JSON.stringify({ path: target })));
    expect(JSON.parse(r).type).toBe('directory');
  });

  it('returns type=symlink for a symlink', async () => {
    const handler = makeFileStatHandler({ policy: allowPolicy });
    const realFile = join(tmp, 'real.txt');
    const link = join(tmp, 'link.txt');
    await writeFile(realFile, 'real');
    try {
      await symlink(realFile, link);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM') return; // Windows without symlink perm — skip
      throw err;
    }
    const r = await handler(ctx(JSON.stringify({ path: link })));
    expect(JSON.parse(r).type).toBe('symlink');
  });
});
