// src/shared/ipc-contract/settings.ts
import { z } from 'zod';
import { defineRequest, defineEvent } from './_common';

export const ThemeSchema = z.enum(['light', 'dark', 'system']);
export type Theme = z.infer<typeof ThemeSchema>;

export const LanguageSchema = z.enum(['en', 'zh-Hans', 'zh-Hant']);
export type Language = z.infer<typeof LanguageSchema>;

export const SettingsRequests = {
  'settings.theme.get':     defineRequest({ input: z.object({}), output: ThemeSchema }),
  'settings.theme.set':     defineRequest({ input: z.object({ theme: ThemeSchema }), output: z.void() }),
  'settings.language.get':  defineRequest({ input: z.object({}), output: LanguageSchema }),
  'settings.language.set':  defineRequest({ input: z.object({ language: LanguageSchema }), output: z.void() }),
  // Pre-fills the Login form's server URL field. Returns CLAWNET_E2E_SERVER_URL
  // when set (e2e), else the production default.
  'settings.defaultServerURL.get': defineRequest({
    input: z.object({}),
    output: z.string().url(),
  }),
  /** App version + electron/runtime build info — backs the Settings ▸ About
   *  page. `version` comes from `app.getVersion()` (which reads package.json
   *  in dev, the embedded version in packaged builds). */
  'app.about.get': defineRequest({
    input: z.object({}),
    output: z.object({
      version: z.string(),
      electron: z.string(),
      platform: z.string(),
    }),
  }),
} as const;

export const SettingsEvents = {
  'settings.changed': defineEvent(z.object({
    theme: ThemeSchema.optional(),
    language: LanguageSchema.optional(),
  })),
} as const;
