import { z } from 'zod';
import type { HttpClient } from '../../network/http-client';
import {
  ContactSchema, type Contact,
  FriendRequestSchema, type FriendRequest,
} from '../../../shared/domain/contact';

const ContactsListResponse = z.object({ data: z.array(ContactSchema) });
const ContactResponse = z.object({ data: ContactSchema });
const FriendRequestsListResponse = z.object({ data: z.array(FriendRequestSchema) });
const FriendRequestResponse = z.object({ data: FriendRequestSchema });

export interface ContactServiceOptions {
  http: HttpClient;
}

/**
 * Wraps the REST contacts + friend-request endpoints from macOS ClawNetAPI.swift
 * (444-471 contacts; 551-572 friend-requests). 1:1 with ContactService.swift —
 * note the auto-accept handling on sendFriendRequest at swift lines 50-54.
 */
export class ContactService {
  constructor(private readonly opts: ContactServiceOptions) {}

  // -- Contacts (ClawNetAPI.swift:444-471) --

  async list(): Promise<Contact[]> {
    const raw = await this.opts.http.getJson<unknown>('/api/v1/contacts');
    return ContactsListResponse.parse(raw).data;
  }

  async search(query: string): Promise<Contact[]> {
    if (!query.trim()) return [];
    const raw = await this.opts.http.getJson<unknown>(
      `/api/v1/search/contacts?q=${encodeURIComponent(query)}`,
    );
    return ContactsListResponse.parse(raw).data;
  }

  async add(contactId: string, contactType: 'human' | 'agent' = 'human'): Promise<Contact> {
    const raw = await this.opts.http.postJson<unknown>('/api/v1/contacts', {
      contactId, contactType,
    });
    return ContactResponse.parse(raw).data;
  }

  async delete(contactId: string): Promise<void> {
    await this.opts.http.deleteJson(`/api/v1/contacts/${encodeURIComponent(contactId)}`);
  }

  // -- Friend requests (ClawNetAPI.swift:551-572) --

  async listFriendRequests(): Promise<FriendRequest[]> {
    const raw = await this.opts.http.getJson<unknown>('/api/v1/friend-requests/pending');
    return FriendRequestsListResponse.parse(raw).data;
  }

  /**
   * POST a new friend request. Returns the request payload — the caller
   * must check `status === 'accepted'` and refresh contacts in that case
   * (mirrors ContactService.swift:50-54: server auto-accepts when both
   * parties have already sent each other a request).
   */
  async sendFriendRequest(toUserId: string, message?: string): Promise<FriendRequest | null> {
    const body: Record<string, unknown> = { toUserId };
    if (message !== undefined && message !== '') body.message = message;
    const raw = await this.opts.http.postJson<unknown>('/api/v1/friend-requests', body);
    return FriendRequestResponse.parse(raw).data;
  }

  async acceptFriendRequest(id: string): Promise<void> {
    await this.opts.http.postJson(`/api/v1/friend-requests/${encodeURIComponent(id)}/accept`, {});
  }

  async rejectFriendRequest(id: string): Promise<void> {
    await this.opts.http.postJson(`/api/v1/friend-requests/${encodeURIComponent(id)}/reject`, {});
  }

  /**
   * Assign or clear a contact's tag (ClawNetAPI.swift:508-514).
   * Pass null to unassign — server expects an explicit JSON null, not omission.
   */
  async updateTag(contactId: string, tagId: string | null): Promise<Contact> {
    const raw = await this.opts.http.patchJson<unknown>(
      `/api/v1/contacts/${encodeURIComponent(contactId)}`, { tagId },
    );
    return ContactResponse.parse(raw).data;
  }
}
