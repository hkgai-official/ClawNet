import { z, type ZodTypeAny } from 'zod';

export const PaginationMetaSchema = z.object({
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

export const ApiResponseSchema = <T extends ZodTypeAny>(t: T) =>
  z.object({ data: t });

export const ApiListResponseSchema = <T extends ZodTypeAny>(t: T) =>
  z.object({ data: z.array(t) });

export const ApiPaginatedResponseSchema = <T extends ZodTypeAny>(t: T) =>
  z.object({
    data: z.array(t),
    meta: PaginationMetaSchema.nullable(),
  });
