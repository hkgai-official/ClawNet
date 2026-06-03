import { describe, it, expect } from 'vitest';
import { TrashMetaSchema, serializeTrashMeta, parseTrashMeta } from '../trash';

describe('TrashMetaSchema', () => {
  it('parses canonical meta', () => {
    const m = TrashMetaSchema.parse({
      originalPath: '/x/quarterly.pdf',
      trashedAt: 1747000000000,
      sessionId: 's-1',
    });
    expect(m.originalPath).toBe('/x/quarterly.pdf');
    expect(m.trashedAt).toBe(1747000000000);
    expect(m.sessionId).toBe('s-1');
  });

  it('accepts null sessionId', () => {
    const m = TrashMetaSchema.parse({
      originalPath: '/x', trashedAt: 0, sessionId: null,
    });
    expect(m.sessionId).toBeNull();
  });

  it('rejects negative trashedAt', () => {
    expect(() => TrashMetaSchema.parse({
      originalPath: '/x', trashedAt: -1, sessionId: null,
    })).toThrow();
  });
});

describe('serializeTrashMeta / parseTrashMeta', () => {
  it('round-trips via snake_case on wire (1:1 with macOS JSONEncoder.convertToSnakeCase)', () => {
    const orig = {
      originalPath: '/x/q.pdf',
      trashedAt: 1747000000000,
      sessionId: 's-1',
    };
    const json = serializeTrashMeta(orig);
    expect(JSON.parse(json)).toEqual({
      original_path: '/x/q.pdf',
      trashed_at: 1747000000000,
      session_id: 's-1',
    });
    expect(parseTrashMeta(json)).toEqual(orig);
  });

  it('parseTrashMeta throws on malformed JSON', () => {
    expect(() => parseTrashMeta('not json')).toThrow();
  });

  it('parseTrashMeta throws on missing fields', () => {
    expect(() => parseTrashMeta('{"original_path":"/x"}')).toThrow();
  });
});
