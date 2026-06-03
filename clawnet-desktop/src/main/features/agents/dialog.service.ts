import { z } from 'zod';
import type { HttpClient } from '../../network/http-client';
import { DialogSessionSchema, type DialogSession } from '../../../shared/domain/dialog';

const DialogResponseSchema = z.object({ data: DialogSessionSchema });
const DialogListResponseSchema = z.object({
  data: z.object({ sessions: z.array(DialogSessionSchema), total: z.number() }),
});

/** Minimal gateway surface needed for intent_authorize. Mirrors the chat
 *  service's narrow dependency on `sendEnvelope`. */
export interface DialogGatewayLike {
  sendEnvelope(envelope: { type: string; data?: Record<string, unknown> }): void;
}

export interface DialogServiceOptions {
  http: HttpClient;
  /** Lazy gateway getter — DialogService is constructed before the
   *  gateway connection exists, so we look it up on demand. */
  getGateway?: () => DialogGatewayLike | null;
}

export class DialogService {
  constructor(private readonly opts: DialogServiceOptions) {}

  /**
   * Approve or deny an intent authorization request. Mirrors macOS
   * ChatService.intentAuthorize (ChatService.swift:1013-1031):
   * sends a `dialog.intent_authorize` WS envelope.
   */
  intentAuthorize(authorizationId: string, approved: boolean): void {
    const gateway = this.opts.getGateway?.();
    if (!gateway) throw new Error('intent_authorize: gateway not connected');
    gateway.sendEnvelope({
      type: 'dialog.intent_authorize',
      data: { authorization_id: authorizationId, approved },
    });
  }

  async create(req: {
    initiatorAgentId: string;
    responderAgentId: string;
    topic: string;
    maxRounds: number;
  }): Promise<DialogSession> {
    const raw = await this.opts.http.postJson<unknown>('/api/v1/agent-dialogs', {
      initiatorAgentId: req.initiatorAgentId,
      responderAgentId: req.responderAgentId,
      topic: req.topic,
      maxRounds: req.maxRounds,
    });
    return DialogResponseSchema.parse(raw).data;
  }

  async list(status?: string): Promise<DialogSession[]> {
    const path = status
      ? `/api/v1/agent-dialogs?status=${encodeURIComponent(status)}`
      : '/api/v1/agent-dialogs';
    const raw = await this.opts.http.getJson<unknown>(path);
    return DialogListResponseSchema.parse(raw).data.sessions;
  }

  async getByConv(conversationId: string): Promise<DialogSession | null> {
    try {
      const raw = await this.opts.http.getJson<unknown>(
        `/api/v1/agent-dialogs/by-conversation/${conversationId}`,
      );
      return DialogResponseSchema.parse(raw).data;
    } catch {
      return null;
    }
  }

  async approve(sessionId: string, approved: boolean, reason?: string): Promise<void> {
    const body: Record<string, unknown> = { approved };
    if (reason !== undefined) body.reason = reason;
    await this.opts.http.postJson(`/api/v1/agent-dialogs/${sessionId}/approve`, body);
  }

  async requestMain(sessionId: string): Promise<void> {
    await this.opts.http.postJson(`/api/v1/agent-dialogs/${sessionId}/request-main`, {});
  }

  async refine(sessionId: string, target: string, instruction: string): Promise<void> {
    await this.opts.http.postJson(`/api/v1/agent-dialogs/${sessionId}/refine`, {
      target,
      instruction,
    });
  }

  async submitResponse(sessionId: string, text: string): Promise<void> {
    await this.opts.http.postJson(`/api/v1/agent-dialogs/${sessionId}/submit-response`, { text });
  }

  async terminate(sessionId: string, reason?: string): Promise<void> {
    const body: Record<string, unknown> = {};
    if (reason !== undefined) body.reason = reason;
    await this.opts.http.postJson(`/api/v1/agent-dialogs/${sessionId}/terminate`, body);
  }

  async extend(sessionId: string, additionalRounds: number): Promise<void> {
    await this.opts.http.postJson(`/api/v1/agent-dialogs/${sessionId}/extend`, {
      additionalRounds,
    });
  }
}
