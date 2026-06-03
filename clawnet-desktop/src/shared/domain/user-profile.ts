// src/shared/domain/user-profile.ts
//
// 1:1 port of macOS UserProfileResponse — ClawNetAPI.swift:842-850.
// Wire keys are snake_case; HttpClient REST boundary
// (commit 24ef910) converts to camelCase on receive.
//
// NOTE: distinct from UserInfoSchema (src/shared/domain/user.ts), which
// is the auth-layer rollup synthesizing `username` from email/displayName.
// UserProfile is the canonical /me response — server-wire identity.

import { z } from 'zod';

export const UserProfileSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  userCode: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
}).passthrough();
export type UserProfile = z.infer<typeof UserProfileSchema>;

// PATCH /api/v1/users/me — any subset. Empty body = no-op (allowed by server).
// Skip-on-undefined semantics match macOS updateCurrentUser (ClawNetAPI.swift:100-110).
export const UpdateUserProfileInputSchema = z.object({
  displayName: z.string().min(1).optional(),
  email: z.string().optional(),
  avatarUrl: z.string().optional(),
});
export type UpdateUserProfileInput = z.infer<typeof UpdateUserProfileInputSchema>;
