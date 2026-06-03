// src/main/features/profile/profile.service.ts
//
// Wraps the REST `/api/v1/users/me*` endpoints from macOS ClawNetAPI.swift:91-116.
// 1:1 with Swift's getCurrentUser / updateCurrentUser / updateLanguage.

import { z } from 'zod';
import type { HttpClient } from '../../network/http-client';
import {
  UserProfileSchema, type UserProfile,
  type UpdateUserProfileInput,
} from '../../../shared/domain/user-profile';
import type { Language } from '../../../shared/ipc-contract';

const MeResponse = z.object({ data: UserProfileSchema });

export interface ProfileServiceOptions {
  http: HttpClient;
}

export class ProfileService {
  constructor(private readonly opts: ProfileServiceOptions) {}

  async getMe(): Promise<UserProfile> {
    const raw = await this.opts.http.getJson<unknown>('/api/v1/users/me');
    return MeResponse.parse(raw).data;
  }

  async updateMe(input: UpdateUserProfileInput): Promise<UserProfile> {
    const body: Record<string, unknown> = {};
    if (input.displayName !== undefined) body.displayName = input.displayName;
    if (input.email !== undefined) body.email = input.email;
    if (input.avatarUrl !== undefined) body.avatarUrl = input.avatarUrl;
    const raw = await this.opts.http.patchJson<unknown>('/api/v1/users/me', body);
    return MeResponse.parse(raw).data;
  }

  async setLanguage(language: Language): Promise<void> {
    await this.opts.http.putJson('/api/v1/users/me/language', { language });
  }
}
