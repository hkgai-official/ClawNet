import { z } from 'zod';
import type { HttpClient } from '../../network/http-client';
import { DiscoveryTaskSchema, type DiscoveryTask } from '../../../shared/domain/discovery';

const DiscoveryResponseSchema = z.object({ data: DiscoveryTaskSchema });
const DiscoveryListResponseSchema = z.object({
  data: z.object({ tasks: z.array(DiscoveryTaskSchema), total: z.number() }),
});

// `pending_queries`, `active_sessions`, `completed_results` items have
// snake_case fields (target_owner, summary, topic) that the renderer
// reads BY snake key in DiscoveryTaskCardView, mirroring macOS
// DiscoveryTaskCardView.swift:135-186. Skipping camel conversion of
// these arrays preserves the inner keys so the card can read them.
const CASE_SKIP = {
  caseSkipKeys: ['pending_queries', 'active_sessions', 'completed_results'],
};

export interface DiscoveryServiceOptions {
  http: HttpClient;
}

export class DiscoveryService {
  constructor(private readonly opts: DiscoveryServiceOptions) {}

  async list(status?: string): Promise<DiscoveryTask[]> {
    const path = status
      ? `/api/v1/discovery-tasks?status=${encodeURIComponent(status)}`
      : '/api/v1/discovery-tasks';
    const raw = await this.opts.http.getJson<unknown>(path, CASE_SKIP);
    return DiscoveryListResponseSchema.parse(raw).data.tasks;
  }

  async get(id: string): Promise<DiscoveryTask> {
    const raw = await this.opts.http.getJson<unknown>(`/api/v1/discovery-tasks/${id}`, CASE_SKIP);
    return DiscoveryResponseSchema.parse(raw).data;
  }

  async getByConv(conversationId: string): Promise<DiscoveryTask | null> {
    try {
      const raw = await this.opts.http.getJson<unknown>(
        `/api/v1/discovery-tasks/by-conversation/${conversationId}`,
        CASE_SKIP,
      );
      return DiscoveryResponseSchema.parse(raw).data;
    } catch {
      return null;
    }
  }

  async confirm(
    id: string,
    queries?: Array<Record<string, unknown>>,
  ): Promise<DiscoveryTask> {
    const body: Record<string, unknown> = {};
    if (queries !== undefined) body.queries = queries;
    const raw = await this.opts.http.postJson<unknown>(
      `/api/v1/discovery-tasks/${id}/confirm`,
      body,
    );
    return DiscoveryResponseSchema.parse(raw).data;
  }

  async cancel(id: string, reason?: string): Promise<DiscoveryTask> {
    const body: Record<string, unknown> = {};
    if (reason !== undefined) body.reason = reason;
    const raw = await this.opts.http.postJson<unknown>(
      `/api/v1/discovery-tasks/${id}/cancel`,
      body,
    );
    return DiscoveryResponseSchema.parse(raw).data;
  }
}
