/**
 * Embedding filter configuration.
 * All values can be overridden via environment variables.
 */
export const EMBEDDING_FILTER_CONFIG = {
  /** Master switch */
  // enabled: process.env.EMBEDDING_FILTER_ENABLED !== "false",
  enabled: false,

  /** DashScope API key (required for filtering to work) */
  apiKey: process.env.DASHSCOPE_API_KEY ?? "",

  /** DashScope-compatible base URL */
  baseUrl: process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",

  /** Embedding model name */
  model: process.env.EMBEDDING_MODEL ?? "text-embedding-v4",

  /** Embedding dimension */
  dimension: Number(process.env.EMBEDDING_DIMENSION ?? 1024),

  /** Chunks with similarity below this threshold are removed */
  similarityThreshold: Number(process.env.EMBEDDING_FILTER_THRESHOLD ?? 0.25),

  /** Always keep the most recent N conversation rounds */
  recentRoundsToKeep: Number(process.env.EMBEDDING_FILTER_RECENT_ROUNDS ?? 3),

  /** Skip filtering when total message count is below this value (0 = always filter) */
  minMessagesForFilter: Number(process.env.EMBEDDING_FILTER_MIN_MESSAGES ?? 0),

  /** Truncate chunk text to this length before computing embeddings */
  maxChunkChars: Number(process.env.EMBEDDING_FILTER_MAX_CHUNK_CHARS ?? 2000),

  /** Request timeout in milliseconds */
  timeoutMs: Number(process.env.EMBEDDING_FILTER_TIMEOUT_MS ?? 10000),

  /**
   * System-prompt section titles (lowercase) that are always kept.
   * Matched against the `## <title>` heading of each section.
   */
  coreSystemSections: [
    "tooling",
    "tool call style",
    "safety",
    "a2a security",
    "workspace",
    "runtime",
    "current date",
    "authorized sender",
    "openclaw cli",
    "openclaw self-update",
    "sandbox",
  ],
};
