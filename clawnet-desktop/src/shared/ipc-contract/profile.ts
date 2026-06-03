// src/shared/ipc-contract/profile.ts
import { z } from 'zod';
import { defineRequest } from './_common';
import {
  UserProfileSchema,
  UpdateUserProfileInputSchema,
} from '../domain/user-profile';
import { LanguageSchema } from './settings';

export const ProfileRequests = {
  'profile.get': defineRequest({
    input: z.object({}),
    output: UserProfileSchema,
  }),
  'profile.update': defineRequest({
    input: UpdateUserProfileInputSchema,
    output: UserProfileSchema,
  }),
  'profile.setLanguage': defineRequest({
    input: z.object({ language: LanguageSchema }),
    output: z.void(),
  }),
} as const;

export const ProfileEvents = {} as const;
