import { describe, it, expect } from 'vitest';
import { ApiResponseSchema, ApiListResponseSchema, ApiPaginatedResponseSchema } from '../envelope';
import { z } from 'zod';

const Item = z.object({ id: z.string(), name: z.string() });

describe('envelope', () => {
  it('ApiResponseSchema parses {data: T}', () => {
    const schema = ApiResponseSchema(Item);
    const parsed = schema.parse({ data: { id: '1', name: 'a' } });
    expect(parsed.data.id).toBe('1');
  });

  it('ApiListResponseSchema parses {data: T[]}', () => {
    const schema = ApiListResponseSchema(Item);
    const parsed = schema.parse({ data: [{ id: '1', name: 'a' }, { id: '2', name: 'b' }] });
    expect(parsed.data).toHaveLength(2);
  });

  it('ApiPaginatedResponseSchema parses {data: T[], meta: {...}|null}', () => {
    const schema = ApiPaginatedResponseSchema(Item);
    const parsed = schema.parse({
      data: [{ id: '1', name: 'a' }],
      meta: { page: 1, pageSize: 50, total: 1, hasMore: false },
    });
    expect(parsed.meta?.total).toBe(1);

    const parsedNull = schema.parse({ data: [], meta: null });
    expect(parsedNull.meta).toBeNull();
  });
});
