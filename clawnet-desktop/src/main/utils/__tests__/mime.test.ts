import { describe, it, expect } from 'vitest';
import { mimeFromExtension, mediaContentType } from '../mime';

describe('mimeFromExtension', () => {
  it('maps common extensions', () => {
    expect(mimeFromExtension('photo.png')).toBe('image/png');
    expect(mimeFromExtension('a.pdf')).toBe('application/pdf');
    expect(mimeFromExtension('clip.mp4')).toBe('video/mp4');
    expect(mimeFromExtension('voice.m4a')).toBe('audio/mp4');
    expect(mimeFromExtension('IMG.JPG')).toBe('image/jpeg');
  });

  it('falls back to application/octet-stream for unknown', () => {
    expect(mimeFromExtension('weird.xyalice')).toBe('application/octet-stream');
  });

  it('falls back to application/octet-stream when no extension', () => {
    expect(mimeFromExtension('README')).toBe('application/octet-stream');
  });
});

describe('mediaContentType', () => {
  it('maps mime prefix to MessageContentType raw value', () => {
    expect(mediaContentType('image/png')).toBe('image');
    expect(mediaContentType('video/mp4')).toBe('video');
    expect(mediaContentType('audio/m4a')).toBe('voice');
    expect(mediaContentType('application/pdf')).toBe('file');
  });
});
