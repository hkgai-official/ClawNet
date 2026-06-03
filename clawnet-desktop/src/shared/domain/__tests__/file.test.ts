import { describe, it, expect } from 'vitest';
import { FileInfoSchema } from '../file';

describe('FileInfoSchema', () => {
  it('parses canonical file info (mirrors ClawNetAPI.swift:167-174)', () => {
    const f = FileInfoSchema.parse({
      id: 'f1',
      name: 'doc.pdf',
      size: 1024,
      mimeType: 'application/pdf',
    });
    expect(f.id).toBe('f1');
    expect(f.size).toBe(1024);
    expect(f.mimeType).toBe('application/pdf');
  });

  it('accepts optional url + thumbnailUrl as null', () => {
    const f = FileInfoSchema.parse({
      id: 'f1',
      name: 'a.png',
      size: 1,
      mimeType: 'image/png',
      url: null,
      thumbnailUrl: null,
    });
    expect(f.url).toBeNull();
    expect(f.thumbnailUrl).toBeNull();
  });

  it('rejects negative size', () => {
    expect(() => FileInfoSchema.parse({ id: 'f1', name: 'a', size: -1, mimeType: 'x/y' })).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => FileInfoSchema.parse({ id: 'f1', name: 'a' })).toThrow();
  });
});
