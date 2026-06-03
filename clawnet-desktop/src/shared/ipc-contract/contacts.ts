import { z } from 'zod';
import { defineRequest, defineEvent } from './_common';
import {
  ContactSchema, ContactTypeSchema,
  FriendRequestSchema,
} from '../domain/contact';

export const ContactsRequests = {
  'contacts.list': defineRequest({
    input: z.object({}),
    output: z.array(ContactSchema),
  }),
  'contacts.search': defineRequest({
    input: z.object({ query: z.string() }),
    output: z.array(ContactSchema),
  }),
  'contacts.add': defineRequest({
    input: z.object({
      contactId: z.string(),
      contactType: ContactTypeSchema.optional(),
    }),
    output: ContactSchema,
  }),
  'contacts.delete': defineRequest({
    input: z.object({ contactId: z.string() }),
    output: z.void(),
  }),
  'contacts.updateTag': defineRequest({
    input: z.object({
      contactId: z.string(),
      tagId: z.string().nullable(),
    }),
    output: ContactSchema,
  }),
  'friendRequests.list': defineRequest({
    input: z.object({}),
    output: z.array(FriendRequestSchema),
  }),
  'friendRequests.send': defineRequest({
    input: z.object({ toUserId: z.string(), message: z.string().optional() }),
    output: FriendRequestSchema.nullable(),
  }),
  'friendRequests.accept': defineRequest({
    input: z.object({ id: z.string() }),
    output: z.void(),
  }),
  'friendRequests.reject': defineRequest({
    input: z.object({ id: z.string() }),
    output: z.void(),
  }),
} as const;

// Server push events relating to friend-request and contact list state.
// Wire shapes are intentionally passthrough — they're informational
// triggers for the renderer to invalidate its react-query caches; we
// don't validate every field strictly.
const FriendRequestNewSchema = z
  .object({
    fromUserId: z.string().optional(),
    fromUserName: z.string().optional(),
  })
  .passthrough();

const FriendRequestAcceptedSchema = z.record(z.unknown());

export const ContactsEvents = {
  'friend_request.new': defineEvent(FriendRequestNewSchema),
  'friend_request.accepted': defineEvent(FriendRequestAcceptedSchema),
} as const;
