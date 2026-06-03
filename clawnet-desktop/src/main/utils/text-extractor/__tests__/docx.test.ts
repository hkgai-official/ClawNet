import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractDocxFile } from '../docx';

vi.mock('mammoth', () => ({
  extractRawText: vi.fn(),
}));

import * as mammoth from 'mammoth';

beforeEach(() => {
  (mammoth.extractRawText as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe('extractDocxFile', () => {
  it('returns text + format=docx', async () => {
    (mammoth.extractRawText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      value: 'quarterly results',
      messages: [],
    });
    const r = await extractDocxFile('/x/q.docx', 1000);
    expect(r.format).toBe('docx');
    expect(r.text).toBe('quarterly results');
  });

  it('returns null on mammoth error', async () => {
    (mammoth.extractRawText as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('corrupt'));
    const r = await extractDocxFile('/x/bad.docx', 1000);
    expect(r.text).toBeNull();
    expect(r.format).toBe('docx');
  });

  it('returns null on empty value', async () => {
    (mammoth.extractRawText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ value: '', messages: [] });
    const r = await extractDocxFile('/x/empty.docx', 1000);
    expect(r.text).toBeNull();
  });
});
