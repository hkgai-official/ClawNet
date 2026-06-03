// Diagnostic probe — kept skipped so it doesn't pollute regular runs.
// Re-enable locally by removing `.skip` to dump renderer DOM + console
// output during sign-in (used to debug round-5 Composer infinite-render).
import { test } from '@playwright/test';

test.skip('probe (manual only)', async () => {
  // intentionally empty
});
