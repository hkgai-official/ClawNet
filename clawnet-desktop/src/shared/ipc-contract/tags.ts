// src/shared/ipc-contract/tags.ts
import { z } from 'zod';
import { defineRequest } from './_common';
import {
  TagSchema, NodeAclSchema,
} from '../domain/tag';

const CreateInput = z.object({
  displayName: z.string().min(1),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  nodeAcl: NodeAclSchema.optional(),
});

const UpdateInput = z.object({
  id: z.string(),
  displayName: z.string().min(1).optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  nodeAcl: NodeAclSchema.optional(),
});

export const TagsRequests = {
  'tags.list': defineRequest({
    input: z.object({}),
    output: z.array(TagSchema),
  }),
  'tags.create': defineRequest({
    input: CreateInput,
    output: TagSchema,
  }),
  'tags.update': defineRequest({
    input: UpdateInput,
    output: TagSchema,
  }),
  'tags.delete': defineRequest({
    input: z.object({ id: z.string() }),
    output: z.void(),
  }),
} as const;

export const TagsEvents = {} as const;
