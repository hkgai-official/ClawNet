// src/shared/domain/tag.ts
//
// 1:1 port of macOS ClawNet/Models/TagModels.swift (lines 5-23).
// Wire keys are snake_case; HttpClient REST boundary
// (commit 24ef910) converts to camelCase on receive.

import { z } from 'zod';

// NodeAcl.accessMode — TagModels.swift:22
// Wire values: "rw" (default) or "ro" (read-only for delegate agents).
// Null/undefined on wire means "default" (rw).
export const NodeAclAccessModeSchema = z.enum(['rw', 'ro']);
export type NodeAclAccessMode = z.infer<typeof NodeAclAccessModeSchema>;

// Tag.NodeAcl — TagModels.swift:19-23
export const NodeAclSchema = z.object({
  allowedPaths: z.array(z.string()).default([]),
  deniedPaths: z.array(z.string()).default([]),
  accessMode: NodeAclAccessModeSchema.nullable().optional(),
});
export type NodeAcl = z.infer<typeof NodeAclSchema>;

// Tag — TagModels.swift:5-17
export const TagSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  displayName: z.string(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  isDefault: z.boolean(),
  isMain: z.boolean().nullable().optional(),
  workspaceId: z.string(),
  nodeAcl: NodeAclSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();
export type Tag = z.infer<typeof TagSchema>;

// Input shape for create — display_name required; node_acl + icon + color optional.
// Mirrors Swift createTag(displayName:icon:color:nodeAcl:) signature.
export const CreateTagInputSchema = z.object({
  displayName: z.string().min(1),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  nodeAcl: NodeAclSchema.optional(),
});
export type CreateTagInput = z.infer<typeof CreateTagInputSchema>;

// Input shape for update — all fields optional (PATCH semantics).
export const UpdateTagInputSchema = z.object({
  displayName: z.string().min(1).optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  nodeAcl: NodeAclSchema.optional(),
});
export type UpdateTagInput = z.infer<typeof UpdateTagInputSchema>;
