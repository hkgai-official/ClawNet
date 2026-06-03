// src/main/features/audit/audit.service.ts
import { z } from 'zod';
import type { HttpClient } from '../../network/http-client';
import type { AuditEvent } from '../../../shared/domain/audit';

const ServerEventSchema = z.object({
  id: z.string(),
  operationType: z.string(),
  agentId: z.string().optional(),
  // operation_details / operationDetails values are server-controlled opaque
  // payloads — HttpClient is given caseSkipKeys=['operation_details'] so the
  // keys inside (agent_name, tag_role, …) keep their on-the-wire shape.
  operationDetails: z.record(z.unknown()).optional(),
  timestamp: z.string(),
});

const ListResponseSchema = z.object({
  data: z.array(ServerEventSchema),
});

export interface AuditServiceOptions {
  http: HttpClient;
}

function toStringRecord(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export class AuditService {
  constructor(private readonly opts: AuditServiceOptions) {}

  async list({ limit, offset }: { limit: number; offset: number }): Promise<AuditEvent[]> {
    const raw = await this.opts.http.getJson<unknown>(
      `/api/v1/audit/events?limit=${limit}&offset=${offset}`,
      { caseSkipKeys: ['operation_details'] },
    );
    const parsed = ListResponseSchema.parse(raw);
    return parsed.data.map((ev) => {
      const details = ev.operationDetails ?? {};
      return {
        id: ev.id,
        eventType: `audit.${ev.operationType}`,
        agentId: ev.agentId,
        agentName: typeof details['agent_name'] === 'string' ? details['agent_name'] : undefined,
        tagRole: typeof details['tag_role'] === 'string' ? details['tag_role'] : undefined,
        details: toStringRecord(details),
        timestamp: ev.timestamp,
        isRead: true,
      };
    });
  }
}
