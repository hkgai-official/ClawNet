import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeFileSearchHandler } from '../file-search';

vi.mock('../../../../utils/fs-walker', () => ({
  walkFiles: vi.fn(),
}));
vi.mock('../../../../utils/text-extractor', () => ({
  extractText: vi.fn(),
}));
import { walkFiles } from '../../../../utils/fs-walker';
import { extractText } from '../../../../utils/text-extractor';

type Policy = {
  check: ReturnType<typeof vi.fn>;
};

let tmpRoot: string;
let policy: Policy;

beforeEach(() => {
  (walkFiles as ReturnType<typeof vi.fn>).mockReset();
  (extractText as ReturnType<typeof vi.fn>).mockReset();
  policy = {
    check: vi.fn().mockReturnValue({ decision: 'allow', reason: 'ok' }),
  };
  tmpRoot = mkdtempSync(join(tmpdir(), 'fs-handler-'));
});

function makeCtx(overrides: { paramsJSON?: string; tagNodeAcl?: unknown } = {}) {
  const ctx: {
    invokeId: string;
    paramsJSON?: string;
    workspaceRoot?: string;
    tagNodeAcl?: unknown;
  } = { invokeId: 'invoke-1' };
  if (overrides.paramsJSON !== undefined) ctx.paramsJSON = overrides.paramsJSON;
  if (overrides.tagNodeAcl !== undefined) ctx.tagNodeAcl = overrides.tagNodeAcl;
  return ctx;
}

describe('makeFileSearchHandler', () => {
  it('returns errorJSON when paramsJSON missing path', async () => {
    const handler = makeFileSearchHandler({ policy });
    const result = await handler(makeCtx({ paramsJSON: '{"keywords":["x"]}' }));
    expect(JSON.parse(result).error).toMatch(/missing path/);
  });

  it('returns errorJSON when paramsJSON missing keywords', async () => {
    const handler = makeFileSearchHandler({ policy });
    const result = await handler(makeCtx({ paramsJSON: '{"path":"/x"}' }));
    expect(JSON.parse(result).error).toMatch(/missing keywords/);
  });

  it('returns errorJSON when paramsJSON is not valid JSON', async () => {
    const handler = makeFileSearchHandler({ policy });
    const result = await handler(makeCtx({ paramsJSON: 'not json' }));
    expect(JSON.parse(result).error).toMatch(/invalid params|missing path/);
  });

  it('enforces global policy.check on the search path', async () => {
    const handler = makeFileSearchHandler({ policy });
    policy.check.mockReturnValue({ decision: 'deny', reason: 'server-denied' });
    const result = await handler(makeCtx({
      paramsJSON: JSON.stringify({ path: tmpRoot, keywords: ['foo'] }),
    }));
    expect(policy.check).toHaveBeenCalled();
    expect(JSON.parse(result).error).toMatch(/server-denied/);
  });

  it('returns NOT_FOUND when path does not exist', async () => {
    const handler = makeFileSearchHandler({ policy });
    const result = await handler(makeCtx({
      paramsJSON: JSON.stringify({ path: '/definitely/not/here', keywords: ['x'] }),
    }));
    expect(JSON.parse(result).error).toMatch(/NOT_FOUND/);
  });

  it('returns empty results when walker returns no files', async () => {
    (walkFiles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const handler = makeFileSearchHandler({ policy });
    const result = await handler(makeCtx({
      paramsJSON: JSON.stringify({ path: tmpRoot, keywords: ['foo'] }),
    }));
    const parsed = JSON.parse(result);
    expect(parsed.results).toEqual([]);
    expect(parsed.count).toBe(0);
    expect(parsed.basePath).toBe(tmpRoot);
  });

  it('builds result entry with keyword hits for filename match', async () => {
    (walkFiles as ReturnType<typeof vi.fn>).mockResolvedValue([
      { path: join(tmpRoot, 'quarterly.txt'), size: 100 },
    ]);
    (extractText as ReturnType<typeof vi.fn>).mockResolvedValue({ text: null, format: 'text' });
    const handler = makeFileSearchHandler({ policy });
    const result = await handler(makeCtx({
      paramsJSON: JSON.stringify({ path: tmpRoot, keywords: ['quarterly'] }),
    }));
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(1);
    expect(parsed.results[0].name).toBe('quarterly.txt');
    expect(parsed.results[0].keywordHits).toEqual(['quarterly']);
    expect(parsed.results[0].size).toBe(100);
  });

  it('skips files larger than 500MB', async () => {
    (walkFiles as ReturnType<typeof vi.fn>).mockResolvedValue([
      { path: join(tmpRoot, 'huge.bin'), size: 600 * 1024 * 1024 },
    ]);
    const handler = makeFileSearchHandler({ policy });
    const result = await handler(makeCtx({
      paramsJSON: JSON.stringify({ path: tmpRoot, keywords: ['x'] }),
    }));
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(0);
  });

  it('truncates text to parseMaxTextLength (500_000) + sets truncated:true', async () => {
    const longText = 'x'.repeat(600_000);
    (walkFiles as ReturnType<typeof vi.fn>).mockResolvedValue([
      { path: join(tmpRoot, 'big.txt'), size: 1_000_000 },
    ]);
    (extractText as ReturnType<typeof vi.fn>).mockResolvedValue({ text: longText, format: 'text' });
    const handler = makeFileSearchHandler({ policy });
    const result = await handler(makeCtx({
      paramsJSON: JSON.stringify({ path: tmpRoot, keywords: ['x'] }),
    }));
    const parsed = JSON.parse(result);
    expect(parsed.results[0].text.length).toBe(500_000);
    expect(parsed.results[0].truncated).toBe(true);
  });

  it('caps results at maxResults (default 50)', async () => {
    const files = Array.from({ length: 100 }, (_, i) => ({
      path: join(tmpRoot, `q${i}.txt`),
      size: 10,
    }));
    (walkFiles as ReturnType<typeof vi.fn>).mockResolvedValue(files);
    (extractText as ReturnType<typeof vi.fn>).mockResolvedValue({ text: null, format: 'text' });
    const handler = makeFileSearchHandler({ policy });
    const result = await handler(makeCtx({
      paramsJSON: JSON.stringify({ path: tmpRoot, keywords: ['q'] }),
    }));
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(50);
    expect(parsed.maxResults).toBe(50);
  });

  it('respects maxResults param (clamped to absoluteMaxResults=200)', async () => {
    const files = Array.from({ length: 300 }, (_, i) => ({
      path: join(tmpRoot, `q${i}.txt`),
      size: 10,
    }));
    (walkFiles as ReturnType<typeof vi.fn>).mockResolvedValue(files);
    (extractText as ReturnType<typeof vi.fn>).mockResolvedValue({ text: null, format: 'text' });
    const handler = makeFileSearchHandler({ policy });
    const result = await handler(makeCtx({
      paramsJSON: JSON.stringify({ path: tmpRoot, keywords: ['q'], maxResults: 500 }),
    }));
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(200);
    expect(parsed.maxResults).toBe(200);
  });

  // Fix #2: blobId so the LLM agent can read full body without an
  // extra file.read round-trip.
  describe('blobId in results', () => {
    it('attaches blobId to entries with extracted text when blobClient is provided', async () => {
      (walkFiles as ReturnType<typeof vi.fn>).mockResolvedValue([
        { path: join(tmpRoot, 'a.txt'), size: 100 },
      ]);
      (extractText as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'hello matched body', format: 'text' });
      const uploadSpy = vi.fn().mockResolvedValue({ blobId: 'blob-abc' });
      const handler = makeFileSearchHandler({ policy, blobClient: { upload: uploadSpy } });
      const result = await handler(makeCtx({
        paramsJSON: JSON.stringify({ path: tmpRoot, keywords: ['matched'] }),
      }));
      const parsed = JSON.parse(result);
      expect(parsed.count).toBe(1);
      expect(parsed.results[0].blobId).toBe('blob-abc');
      expect(parsed.results[0].text).toBe('hello matched body');
      expect(uploadSpy).toHaveBeenCalledOnce();
      const [arg] = uploadSpy.mock.calls[0]!;
      expect(Buffer.isBuffer(arg)).toBe(true);
      expect(arg.toString('utf-8')).toBe('hello matched body');
    });

    it('omits blobId when text is null (filename-only match)', async () => {
      (walkFiles as ReturnType<typeof vi.fn>).mockResolvedValue([
        { path: join(tmpRoot, 'foo.png'), size: 10 },
      ]);
      (extractText as ReturnType<typeof vi.fn>).mockResolvedValue({ text: null, format: 'image' });
      const uploadSpy = vi.fn();
      const handler = makeFileSearchHandler({ policy, blobClient: { upload: uploadSpy } });
      const result = await handler(makeCtx({
        paramsJSON: JSON.stringify({ path: tmpRoot, keywords: ['foo'] }),
      }));
      const parsed = JSON.parse(result);
      expect(parsed.results[0].blobId).toBeUndefined();
      expect(uploadSpy).not.toHaveBeenCalled();
    });

    it('omits blobId when upload fails (returns null)', async () => {
      (walkFiles as ReturnType<typeof vi.fn>).mockResolvedValue([
        { path: join(tmpRoot, 'a.txt'), size: 100 },
      ]);
      (extractText as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'body', format: 'text' });
      const handler = makeFileSearchHandler({
        policy,
        blobClient: { upload: vi.fn().mockResolvedValue(null) },
      });
      const result = await handler(makeCtx({
        paramsJSON: JSON.stringify({ path: tmpRoot, keywords: ['body'] }),
      }));
      const parsed = JSON.parse(result);
      expect(parsed.results[0].blobId).toBeUndefined();
      expect(parsed.results[0].text).toBe('body');  // text still inline
    });

    it('works without blobClient (existing behavior preserved)', async () => {
      (walkFiles as ReturnType<typeof vi.fn>).mockResolvedValue([
        { path: join(tmpRoot, 'a.txt'), size: 100 },
      ]);
      (extractText as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'body', format: 'text' });
      const handler = makeFileSearchHandler({ policy });
      const result = await handler(makeCtx({
        paramsJSON: JSON.stringify({ path: tmpRoot, keywords: ['body'] }),
      }));
      const parsed = JSON.parse(result);
      expect(parsed.results[0].blobId).toBeUndefined();
      expect(parsed.results[0].text).toBe('body');
    });
  });
});
