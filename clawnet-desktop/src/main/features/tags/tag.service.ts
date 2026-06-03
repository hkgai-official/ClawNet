// src/main/features/tags/tag.service.ts
//
// Wraps the REST tag endpoints from macOS ClawNetAPI.swift (473-506).
// 1:1 with TagService.swift entry points (createTag/updateTag/deleteTag).
// Owner-id, workspace-id, is_default, is_main are server-managed; we never
// send them in create/update bodies.

import { z } from 'zod';
import type { HttpClient } from '../../network/http-client';
import {
  TagSchema, type Tag,
  type CreateTagInput, type UpdateTagInput,
} from '../../../shared/domain/tag';

const TagListResponse = z.object({ data: z.array(TagSchema) });
const TagResponse = z.object({ data: TagSchema });

export interface TagServiceOptions {
  http: HttpClient;
}

export class TagService {
  constructor(private readonly opts: TagServiceOptions) {}

  async list(): Promise<Tag[]> {
    const raw = await this.opts.http.getJson<unknown>('/api/v1/tags');
    return TagListResponse.parse(raw).data;
  }

  async create(input: CreateTagInput): Promise<Tag> {
    const body: Record<string, unknown> = { displayName: input.displayName };
    if (input.icon != null) body.icon = input.icon;
    if (input.color != null) body.color = input.color;
    if (input.nodeAcl !== undefined) body.nodeAcl = input.nodeAcl;
    const raw = await this.opts.http.postJson<unknown>('/api/v1/tags', body);
    return TagResponse.parse(raw).data;
  }

  async update(id: string, input: UpdateTagInput): Promise<Tag> {
    const body: Record<string, unknown> = {};
    if (input.displayName !== undefined) body.displayName = input.displayName;
    if (input.icon !== undefined) body.icon = input.icon;
    if (input.color !== undefined) body.color = input.color;
    if (input.nodeAcl !== undefined) body.nodeAcl = input.nodeAcl;
    const raw = await this.opts.http.patchJson<unknown>(
      `/api/v1/tags/${encodeURIComponent(id)}`, body,
    );
    return TagResponse.parse(raw).data;
  }

  async delete(id: string): Promise<void> {
    await this.opts.http.deleteJson(`/api/v1/tags/${encodeURIComponent(id)}`);
  }
}
