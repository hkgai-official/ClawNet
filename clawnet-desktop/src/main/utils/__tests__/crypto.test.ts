import { describe, it, expect } from 'vitest';
import { sha256Hex } from '../crypto';

describe('sha256Hex', () => {
  it('returns 64-hex-char hash for a Buffer', () => {
    // sha256('hello') == 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    const hex = sha256Hex(Buffer.from('hello'));
    expect(hex).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('returns 64 chars even for empty input', () => {
    const hex = sha256Hex(Buffer.from(''));
    expect(hex).toHaveLength(64);
  });

  it('is stable across invocations', () => {
    const buf = Buffer.from('clawnet-p2a');
    expect(sha256Hex(buf)).toBe(sha256Hex(buf));
  });
});
