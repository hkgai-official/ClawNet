import { describe, it, expect, vi } from 'vitest';
import { matchKeywords } from '../keyword-matcher';

describe('matchKeywords', () => {
  it('skips content extraction when all keywords match filename', async () => {
    const extractText = vi.fn();
    const result = await matchKeywords(
      '/x/quarterly-report-2026.pdf',
      'quarterly-report-2026.pdf',
      'pdf',
      1000,
      ['quarterly', '2026'],
      { extractText },
    );
    expect(extractText).not.toHaveBeenCalled();
    expect(result.hits).toEqual(['quarterly', '2026']);
    expect(result.text).toBeNull();
    expect(result.format).toBe('pdf');
  });

  it('extracts content when some keywords are missing from filename', async () => {
    const extractText = vi.fn().mockResolvedValue({
      text: 'this is the body containing revenue numbers',
      format: 'pdf',
    });
    const result = await matchKeywords(
      '/x/quarterly.pdf',
      'quarterly.pdf',
      'pdf',
      1000,
      ['quarterly', 'revenue'],
      { extractText },
    );
    expect(extractText).toHaveBeenCalledOnce();
    expect(result.hits).toEqual(['quarterly', 'revenue']);
    expect(result.text).toBe('this is the body containing revenue numbers');
  });

  it('returns no hits + null text when neither name nor content match', async () => {
    const extractText = vi.fn().mockResolvedValue({
      text: 'unrelated body',
      format: 'text',
    });
    const result = await matchKeywords(
      '/x/file.txt',
      'file.txt',
      'txt',
      100,
      ['xyz'],
      { extractText },
    );
    expect(result.hits).toEqual([]);
    expect(result.text).toBeNull();
  });

  it('returns name hits + null text when extractor returns null', async () => {
    const extractText = vi.fn().mockResolvedValue({ text: null, format: 'binary' });
    const result = await matchKeywords(
      '/x/quarterly.bin',
      'quarterly.bin',
      'bin',
      100,
      ['quarterly', 'revenue'],
      { extractText },
    );
    expect(result.hits).toEqual(['quarterly']);
    expect(result.text).toBeNull();
    expect(result.format).toBe('binary');
  });

  it('lowercases comparison (case-insensitive)', async () => {
    const extractText = vi.fn().mockResolvedValue({
      text: 'REVENUE',
      format: 'text',
    });
    const result = await matchKeywords(
      '/x/QUARTERLY.txt',
      'QUARTERLY.txt',
      'txt',
      100,
      ['quarterly', 'revenue'],
      { extractText },
    );
    expect(result.hits).toEqual(['quarterly', 'revenue']);
  });
});
