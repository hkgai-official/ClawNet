import { z } from 'zod';
import { defineRequest, defineEvent } from './_common';
import { UserInfoSchema } from '../domain/user';
import { AuthStateSchema } from '../domain/auth';

export const AuthRequests = {
  'auth.login': defineRequest({
    input: z.object({
      serverURL: z.string().url(),
      username: z.string().min(1),
      password: z.string().min(1),
    }),
    output: UserInfoSchema,
  }),
  'auth.logout': defineRequest({
    input: z.object({}),
    output: z.void(),
  }),
  'auth.restoreSession': defineRequest({
    input: z.object({}),
    output: z.union([UserInfoSchema, z.null()]),
  }),
  'auth.changePassword': defineRequest({
    input: z.object({
      oldPassword: z.string().min(1),
      newPassword: z.string().min(1),
    }),
    output: z.void(),
  }),
  'auth.updateServerURL': defineRequest({
    input: z.object({ serverURL: z.string().url() }),
    output: z.void(),
  }),
} as const;

export const AuthEvents = {
  'auth.stateChanged': defineEvent(AuthStateSchema),
  // Fired when the just-authenticated user.id differs from the last one
  // we saw on this install. Renderer reacts by clearing the React Query
  // cache so the previous user's conversations/agents/etc don't flash
  // before the new user's data lands.
  'auth.userSwitched': defineEvent(z.object({ userId: z.string() })),
} as const;
