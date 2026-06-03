import { describe, it, expect } from 'vitest';
import {
  JSONValueSchema,
  ReverseActionSchema,
  LogEntrySchema,
  LogFilterSchema,
  LogQueryResultSchema,
} from '../operation';

describe('JSONValueSchema', () => {
  it('accepts string/number/bool/null', () => {
    expect(JSONValueSchema.parse('hi')).toBe('hi');
    expect(JSONValueSchema.parse(42)).toBe(42);
    expect(JSONValueSchema.parse(true)).toBe(true);
    expect(JSONValueSchema.parse(null)).toBe(null);
  });

  it('rejects arrays and objects', () => {
    expect(JSONValueSchema.safeParse([1, 2]).success).toBe(false);
    expect(JSONValueSchema.safeParse({ a: 1 }).success).toBe(false);
  });
});

describe('ReverseActionSchema', () => {
  it('parses {command, params:{...}}', () => {
    const r = ReverseActionSchema.parse({ command: 'file.move', params: { source: '/a', destination: '/b' } });
    expect(r.command).toBe('file.move');
    expect(r.params.source).toBe('/a');
  });

  it('rejects nested objects in params', () => {
    expect(ReverseActionSchema.safeParse({ command: 'x', params: { nested: { y: 1 } } }).success).toBe(false);
  });
});

describe('LogEntrySchema', () => {
  it('parses a minimal entry', () => {
    const e = LogEntrySchema.parse({
      id: 'op_abcd',
      timestamp: 1700000000000,
      command: 'file.move',
      params: { source: '/a', destination: '/b' },
      result: 'success',
      reversible: true,
    });
    expect(e.id).toBe('op_abcd');
    expect(e.sessionId).toBeUndefined();
  });

  it('parses an undo entry with type and undoTargetId', () => {
    const e = LogEntrySchema.parse({
      id: 'op_xxxx',
      timestamp: 1700000001000,
      command: 'file.move',
      params: { source: '/b', destination: '/a' },
      result: 'success',
      reversible: false,
      type: 'undo',
      undoTargetId: 'op_abcd',
    });
    expect(e.type).toBe('undo');
    expect(e.undoTargetId).toBe('op_abcd');
  });

  it('rejects entries missing required fields', () => {
    expect(LogEntrySchema.safeParse({ id: 'x' }).success).toBe(false);
  });
});

describe('LogFilterSchema', () => {
  it('applies defaults', () => {
    const f = LogFilterSchema.parse({});
    expect(f.limit).toBe(50);
    expect(f.offset).toBe(0);
  });
});

describe('LogQueryResultSchema', () => {
  it('parses {entries,total,hasMore}', () => {
    const r = LogQueryResultSchema.parse({ entries: [], total: 0, hasMore: false });
    expect(r.entries).toEqual([]);
  });
});
