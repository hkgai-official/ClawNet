/**
 * Runtime feature flags for the renderer.
 *
 * Keep this file tiny and dependency-free. Flags here are compile-time
 * constants — no runtime override mechanism yet. If a flag needs to be
 * user-toggleable in the future, lift it into settings and read it
 * from there, leaving the constant as a fallback.
 */
export const FEATURE_FLAGS = {
  /** Show the "Agents" rail button in the left sidebar. */
  agentsRailEnabled: false,
} as const;
