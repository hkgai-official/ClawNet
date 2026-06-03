import { describe, it, expect, vi } from 'vitest';
import { extractText } from '../index';

vi.mock('../pdf', () => ({ extractPdfFile: vi.fn(async () => ({ text: 'pdf', format: 'pdf' })) }));
vi.mock('../docx', () => ({ extractDocxFile: vi.fn(async () => ({ text: 'docx', format: 'docx' })) }));
vi.mock('../doc', () => ({ extractDocFile: vi.fn(async () => ({ text: 'doc', format: 'doc' })) }));
vi.mock('../rtf', () => ({ extractRtfFile: vi.fn(async () => ({ text: 'rtf', format: 'rtf' })) }));
vi.mock('../rtfd', () => ({ extractRtfdFile: vi.fn(async () => ({ text: 'rtfd', format: 'rtfd' })) }));
vi.mock('../html', () => ({ extractHtmlFile: vi.fn(async () => ({ text: 'html', format: 'html' })) }));
vi.mock('../text', async () => ({
  extractTextFile: vi.fn(async () => ({ text: 'text', format: 'text' })),
}));

describe('extractText dispatcher', () => {
  it.each([
    ['pdf', 'pdf'],
    ['docx', 'docx'],
    ['doc', 'doc'],
    ['rtf', 'rtf'],
    ['rtfd', 'rtfd'],
    ['html', 'html'],
    ['htm', 'html'],
    ['txt', 'text'],
    ['md', 'text'],
    ['ts', 'text'],
    ['', 'text'],
  ])('routes ext "%s" to format=%s', async (ext, expectedFormat) => {
    const r = await extractText('/x/f', ext, 100);
    expect(r.format).toBe(expectedFormat);
  });

  it.each(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'heic'])(
    'returns image stub for ext=%s without calling any extractor',
    async (ext) => {
      const r = await extractText('/x/f', ext, 100);
      expect(r).toEqual({ text: null, format: 'image' });
    },
  );

  it('is case-insensitive on ext', async () => {
    const r = await extractText('/x/f', 'PDF', 100);
    expect(r.format).toBe('pdf');
  });
});
