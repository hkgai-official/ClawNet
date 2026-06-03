import { describe, it, expect } from 'vitest';
import { deepSnakeToCamel, deepCamelToSnake, snakeToCamel, camelToSnake } from '../case-conversion';

describe('snakeToCamel (single key)', () => {
  it('converts snake_case → camelCase', () => {
    expect(snakeToCamel('foo_bar')).toBe('fooBar');
    expect(snakeToCamel('access_token')).toBe('accessToken');
    expect(snakeToCamel('a_b_c_d')).toBe('aBCD');
  });

  it('leaves single-word keys unchanged', () => {
    expect(snakeToCamel('id')).toBe('id');
    expect(snakeToCamel('email')).toBe('email');
  });

  it('leaves already-camelCase keys unchanged', () => {
    expect(snakeToCamel('fooBar')).toBe('fooBar');
  });

  it('preserves leading underscores (private/system keys)', () => {
    expect(snakeToCamel('_private')).toBe('_private');
    expect(snakeToCamel('__double')).toBe('__double');
  });
});

describe('camelToSnake (single key)', () => {
  it('converts camelCase → snake_case', () => {
    expect(camelToSnake('fooBar')).toBe('foo_bar');
    expect(camelToSnake('accessToken')).toBe('access_token');
    expect(camelToSnake('aBCD')).toBe('a_b_c_d');
  });

  it('leaves single-word keys unchanged', () => {
    expect(camelToSnake('id')).toBe('id');
  });

  it('leaves already-snake_case keys unchanged', () => {
    expect(camelToSnake('foo_bar')).toBe('foo_bar');
  });
});

describe('deepSnakeToCamel', () => {
  it('converts object keys recursively', () => {
    const input = {
      access_token: 'x',
      refresh_token: 'y',
      user_info: {
        display_name: 'A',
        user_code: 'C1',
      },
    };
    expect(deepSnakeToCamel(input)).toEqual({
      accessToken: 'x',
      refreshToken: 'y',
      userInfo: {
        displayName: 'A',
        userCode: 'C1',
      },
    });
  });

  it('converts inside arrays', () => {
    const input = {
      data: [
        { id: '1', display_name: 'A' },
        { id: '2', display_name: 'B' },
      ],
    };
    const out = deepSnakeToCamel(input) as { data: Array<{ id: string; displayName: string }> };
    expect(out.data[0]).toEqual({ id: '1', displayName: 'A' });
    expect(out.data[1]).toEqual({ id: '2', displayName: 'B' });
  });

  it('preserves primitive values', () => {
    expect(deepSnakeToCamel('hello')).toBe('hello');
    expect(deepSnakeToCamel(42)).toBe(42);
    expect(deepSnakeToCamel(true)).toBe(true);
    expect(deepSnakeToCamel(null)).toBeNull();
    expect(deepSnakeToCamel(undefined)).toBeUndefined();
  });

  it('preserves null values nested', () => {
    expect(deepSnakeToCamel({ user_id: null })).toEqual({ userId: null });
  });

  it('preserves arrays of primitives unchanged shape', () => {
    expect(deepSnakeToCamel([1, 2, 'three'])).toEqual([1, 2, 'three']);
  });

  it('idempotent on already-camel object', () => {
    const input = { fooBar: 1, nested: { bazQux: 2 } };
    expect(deepSnakeToCamel(input)).toEqual(input);
  });

  it('skip option leaves named fields untouched (for AuditEvent.details case)', () => {
    const input = {
      audit_event: 'x',
      details: { agent_name: 'Helper', tag_role: 'admin' },
    };
    const out = deepSnakeToCamel(input, { skipKeys: ['details'] }) as {
      auditEvent: string;
      details: Record<string, string>;
    };
    expect(out.auditEvent).toBe('x');
    expect(out.details).toEqual({ agent_name: 'Helper', tag_role: 'admin' });
  });
});

describe('deepCamelToSnake', () => {
  it('converts object keys recursively', () => {
    const input = {
      contentType: 'text',
      content: { text: 'hi' },
      conversationId: 'c1',
    };
    expect(deepCamelToSnake(input)).toEqual({
      content_type: 'text',
      content: { text: 'hi' },
      conversation_id: 'c1',
    });
  });

  it('idempotent on already-snake object', () => {
    const input = { foo_bar: 1, nested: { baz_qux: 2 } };
    expect(deepCamelToSnake(input)).toEqual(input);
  });

  it('inside arrays', () => {
    const input = [{ userId: 'u1' }, { userId: 'u2' }];
    expect(deepCamelToSnake(input)).toEqual([{ user_id: 'u1' }, { user_id: 'u2' }]);
  });
});
