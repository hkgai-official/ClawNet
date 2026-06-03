import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractRtfFile } from '../rtf';

const { mockParseString } = vi.hoisted(() => ({ mockParseString: vi.fn() }));
vi.mock('rtf-parser', () => ({
  default: { parseString: mockParseString },
  parseString: mockParseString,
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => '{\\rtf1\\ansi rich text body }'),
}));

beforeEach(() => { mockParseString.mockReset(); });

describe('extractRtfFile', () => {
  it('returns flattened paragraph text + format=rtf', async () => {
    mockParseString.mockImplementation((_rtf: string, cb: (err: Error | null, doc?: unknown) => void) => {
      cb(null, {
        content: [
          { content: [{ value: 'rich ' }, { value: 'text ' }] },
          { content: [{ value: 'body' }] },
        ],
      });
    });
    const r = await extractRtfFile('/x/q.rtf', 1000);
    expect(r.format).toBe('rtf');
    expect(r.text).toContain('rich');
    expect(r.text).toContain('body');
  });

  it('returns null on parse error', async () => {
    mockParseString.mockImplementation((_rtf: string, cb: (err: Error | null) => void) => {
      cb(new Error('bad rtf'));
    });
    const r = await extractRtfFile('/x/bad.rtf', 1000);
    expect(r.text).toBeNull();
    expect(r.format).toBe('rtf');
  });
});
