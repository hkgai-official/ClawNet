import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractDocFile } from '../doc';

const mockExtract = vi.fn();
vi.mock('word-extractor', () => {
  return {
    default: class {
      extract = mockExtract;
    },
  };
});

beforeEach(() => {
  mockExtract.mockReset();
});

describe('extractDocFile', () => {
  it('returns getBody() text + format=doc', async () => {
    mockExtract.mockResolvedValue({ getBody: () => 'old word body' });
    const r = await extractDocFile('/x/q.doc', 1000);
    expect(r.format).toBe('doc');
    expect(r.text).toBe('old word body');
  });

  it('returns null on word-extractor throw (graceful fallback for unparseable CFB)', async () => {
    mockExtract.mockRejectedValue(new Error('unsupported cfb structure'));
    const r = await extractDocFile('/x/weird.doc', 1000);
    expect(r.text).toBeNull();
    expect(r.format).toBe('doc');
  });

  it('returns null on empty body', async () => {
    mockExtract.mockResolvedValue({ getBody: () => '' });
    const r = await extractDocFile('/x/empty.doc', 1000);
    expect(r.text).toBeNull();
  });
});
