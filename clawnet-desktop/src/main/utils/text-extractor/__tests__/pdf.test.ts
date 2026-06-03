import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractPdfFile } from '../pdf';

// pdf-parse v2.x exposes a PDFParse class with .getText() / .destroy().
const getTextMock = vi.fn();
const destroyMock = vi.fn(async () => {});

vi.mock('pdf-parse', () => ({
  PDFParse: vi.fn().mockImplementation(() => ({
    getText: getTextMock,
    destroy: destroyMock,
  })),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => Buffer.from([0x25, 0x50, 0x44, 0x46])), // "%PDF"
}));

import { PDFParse } from 'pdf-parse';

beforeEach(() => {
  getTextMock.mockReset();
  destroyMock.mockClear();
  (PDFParse as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe('extractPdfFile', () => {
  it('passes the file buffer to pdf-parse and returns text + format=pdf', async () => {
    getTextMock.mockResolvedValue({ text: 'quarterly numbers', total: 1 });
    const r = await extractPdfFile('/x/q.pdf', 1000);
    expect(r.format).toBe('pdf');
    expect(r.text).toBe('quarterly numbers');
    expect(PDFParse).toHaveBeenCalledOnce();
    expect(getTextMock).toHaveBeenCalledOnce();
  });

  it('returns null on pdf-parse error (graceful)', async () => {
    getTextMock.mockRejectedValue(new Error('corrupt'));
    const r = await extractPdfFile('/x/bad.pdf', 1000);
    expect(r.text).toBeNull();
    expect(r.format).toBe('pdf');
  });

  it('returns null on empty pdf text', async () => {
    getTextMock.mockResolvedValue({ text: '', total: 1 });
    const r = await extractPdfFile('/x/empty.pdf', 1000);
    expect(r.text).toBeNull();
    expect(r.format).toBe('pdf');
  });
});
