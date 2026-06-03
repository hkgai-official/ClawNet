import { z } from 'zod';

// 1:1 port of macOS ClawNet/Models/ContactModels.swift.
// Wire keys are snake_case; HttpClient REST boundary (commit 24ef910)
// converts to camelCase on receive.

// ContactType — ContactModels.swift:23-26
export const ContactTypeSchema = z.enum(['human', 'agent']);
export type ContactType = z.infer<typeof ContactTypeSchema>;

// Contact — ContactModels.swift:9-27
export const ContactSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  type: ContactTypeSchema,
  avatarUrl: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  userCode: z.string().nullable().optional(),
  nickname: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  tagId: z.string().nullable().optional(),
  tagName: z.string().nullable().optional(),
  tagDisplayName: z.string().nullable().optional(),
}).passthrough();
export type Contact = z.infer<typeof ContactSchema>;

// RequestStatus — ContactModels.swift:45-49
export const FriendRequestStatusSchema = z.enum(['pending', 'accepted', 'rejected']);
export type FriendRequestStatus = z.infer<typeof FriendRequestStatusSchema>;

// FriendRequest — ContactModels.swift:31-50
export const FriendRequestSchema = z.object({
  id: z.string(),
  fromUserId: z.string(),
  fromUserName: z.string(),
  fromUserAvatar: z.string().nullable().optional(),
  toUserId: z.string(),
  toUserName: z.string(),
  toUserAvatar: z.string().nullable().optional(),
  fromUserCode: z.string().nullable().optional(),
  toUserCode: z.string().nullable().optional(),
  status: FriendRequestStatusSchema,
  message: z.string().nullable().optional(),
  createdAt: z.string(),
}).passthrough();
export type FriendRequest = z.infer<typeof FriendRequestSchema>;
