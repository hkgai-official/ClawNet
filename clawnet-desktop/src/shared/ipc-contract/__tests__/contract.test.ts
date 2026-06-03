// src/shared/ipc-contract/__tests__/contract.test.ts
import { describe, it, expect } from 'vitest';
import { Requests, Events, ThemeSchema, LanguageSchema } from '../index';

describe('IPC contract', () => {
  it('exports Requests and Events maps', () => {
    expect(Requests['settings.theme.get'].kind).toBe('request');
    expect(Requests['settings.theme.set'].kind).toBe('request');
    expect(Events['settings.changed'].kind).toBe('event');
  });

  it('ThemeSchema rejects unknown values', () => {
    expect(() => ThemeSchema.parse('green')).toThrow();
    expect(ThemeSchema.parse('light')).toBe('light');
  });

  it('LanguageSchema rejects unknown values', () => {
    expect(() => LanguageSchema.parse('fr')).toThrow();
    expect(LanguageSchema.parse('zh-Hans')).toBe('zh-Hans');
  });

  it('Request input schemas validate as expected', () => {
    expect(() => Requests['settings.theme.set'].input.parse({ theme: 'bogus' })).toThrow();
    expect(Requests['settings.theme.set'].input.parse({ theme: 'dark' })).toEqual({ theme: 'dark' });
  });
});
