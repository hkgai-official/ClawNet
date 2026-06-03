import { z } from 'zod';
import type { HttpClient } from '../../network/http-client';
import {
  ServerTaskSchema,
  ExecutionLogSchema,
  type ServerTask,
  type ApprovalDecision,
  type ExecutionLog,
} from '../../../shared/domain/task';

const TaskResponseSchema = z.object({ data: ServerTaskSchema });
const LogListResponseSchema = z.object({ data: z.array(ExecutionLogSchema) });

export interface TaskServiceOptions {
  http: HttpClient;
}

export class TaskService {
  constructor(private readonly opts: TaskServiceOptions) {}

  async create(req: {
    agentId: string;
    conversationId: string;
    description: string;
    priority: string;
  }): Promise<ServerTask> {
    const raw = await this.opts.http.postJson<unknown>('/api/v1/tasks', {
      agentId: req.agentId,
      conversationId: req.conversationId,
      description: req.description,
      priority: req.priority,
    });
    return TaskResponseSchema.parse(raw).data;
  }

  async get(id: string): Promise<ServerTask> {
    const raw = await this.opts.http.getJson<unknown>(`/api/v1/tasks/${id}`);
    return TaskResponseSchema.parse(raw).data;
  }

  async approve(
    id: string,
    decision: ApprovalDecision,
    modifications?: string,
  ): Promise<ServerTask> {
    const body: Record<string, unknown> = { decision };
    if (modifications !== undefined) body.modifications = modifications;
    const raw = await this.opts.http.postJson<unknown>(
      `/api/v1/tasks/${id}/approve`,
      body,
    );
    return TaskResponseSchema.parse(raw).data;
  }

  async cancel(id: string): Promise<ServerTask> {
    const raw = await this.opts.http.postJson<unknown>(
      `/api/v1/tasks/${id}/cancel`,
      {},
    );
    return TaskResponseSchema.parse(raw).data;
  }

  async getLogs(id: string): Promise<ExecutionLog[]> {
    const raw = await this.opts.http.getJson<unknown>(`/api/v1/tasks/${id}/logs`);
    return LogListResponseSchema.parse(raw).data;
  }
}
