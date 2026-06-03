// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { formatConversationTime } from '../format-conversation-time';

// Reference "now" fixed for deterministic tests: 2026-05-20 (Wed) 14:30 local.
const NOW = new Date('2026-05-20T14:30:00');

// Stub i18n by passing it to the helper — keeps the helper pure
// (no react-i18next dependency in the lib layer).
const i18n = {
  yesterday: 'Yesterday',
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

describe('formatConversationTime', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(formatConversationTime(null, NOW, i18n)).toBe('');
    expect(formatConversationTime(undefined, NOW, i18n)).toBe('');
    expect(formatConversationTime('', NOW, i18n)).toBe('');
  });

  it('returns HH:MM for same-day timestamps', () => {
    expect(formatConversationTime('2026-05-20T09:05:00', NOW, i18n)).toBe('09:05');
    expect(formatConversationTime('2026-05-20T14:29:59', NOW, i18n)).toBe('14:29');
    expect(formatConversationTime('2026-05-20T00:00:00', NOW, i18n)).toBe('00:00');
  });

  it('returns localized "Yesterday" for the prior calendar day', () => {
    expect(formatConversationTime('2026-05-19T22:00:00', NOW, i18n)).toBe('Yesterday');
    expect(formatConversationTime('2026-05-19T00:00:01', NOW, i18n)).toBe('Yesterday');
  });

  it('returns weekday name for 2-6 days ago within the current week range', () => {
    // 2026-05-18 is Monday (NOW is Wed) → Mon
    expect(formatConversationTime('2026-05-18T10:00:00', NOW, i18n)).toBe('Mon');
    // 2026-05-14 is the prior Thursday (6 days ago) → Thu
    expect(formatConversationTime('2026-05-14T10:00:00', NOW, i18n)).toBe('Thu');
  });

  it('returns M-D for older dates within this year', () => {
    expect(formatConversationTime('2026-04-30T10:00:00', NOW, i18n)).toBe('4-30');
    expect(formatConversationTime('2026-01-05T10:00:00', NOW, i18n)).toBe('1-5');
  });

  it('returns YYYY/M/D for dates from prior years', () => {
    expect(formatConversationTime('2025-12-31T23:59:00', NOW, i18n)).toBe('2025/12/31');
    expect(formatConversationTime('2024-06-15T10:00:00', NOW, i18n)).toBe('2024/6/15');
  });
});
