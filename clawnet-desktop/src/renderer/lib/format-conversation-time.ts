/**
 * Format a timestamp for a conversation-list row.
 *
 * Output branches (mirrors typical IM convention; the macOS app uses
 * a similar mapping in ConversationListView):
 *
 *   Today              → HH:MM
 *   Yesterday          → localized "Yesterday"
 *   2-6 days ago       → localized weekday (Mon / 周一 / etc.)
 *   Earlier this year  → M-D
 *   Older              → YYYY/M/D
 *
 * Accepts `null` / `undefined` / `''` and returns `''` — the caller
 * (conversation-list) reserves the slot width regardless.
 *
 * `i18n.weekdays` MUST be a 7-element array indexed by `Date.getDay()`
 * (0=Sun, 6=Sat). The caller passes the localized array from i18n
 * resources — keeping this helper pure makes it trivially testable.
 *
 * `now` is parameterized for deterministic tests; production callers
 * pass `new Date()`.
 */
export interface I18nStrings {
  readonly yesterday: string;
  readonly weekdays: readonly string[];
}

export function formatConversationTime(
  iso: string | null | undefined,
  now: Date,
  i18n: I18nStrings,
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const today = startOfDay(now);
  const target = startOfDay(d);
  const dayDelta = Math.round(
    (today.getTime() - target.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (dayDelta === 0) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  if (dayDelta === 1) return i18n.yesterday;
  if (dayDelta >= 2 && dayDelta <= 6) return i18n.weekdays[d.getDay()] ?? '';
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}-${d.getDate()}`;
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
