import { EMBEDDING_FILTER_CONFIG } from "./config.js";

/** DashScope batch size limit */
const BATCH_SIZE = 10;

/**
 * Call DashScope (OpenAI-compatible) embeddings API.
 * Automatically splits into batches of 10 (DashScope limit).
 * Returns an array of embedding vectors, one per input text.
 */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const cfg = EMBEDDING_FILTER_CONFIG;

  // Truncate each text to maxChunkChars
  const truncated = texts.map((t) =>
    t.length > cfg.maxChunkChars ? t.slice(0, cfg.maxChunkChars) : t,
  );

  // Split into batches of BATCH_SIZE
  const allEmbeddings: number[][] = new Array(truncated.length);
  for (let start = 0; start < truncated.length; start += BATCH_SIZE) {
    const batch = truncated.slice(start, start + BATCH_SIZE);
    const batchResult = await fetchEmbeddingBatch(batch, cfg);
    for (let i = 0; i < batchResult.length; i++) {
      allEmbeddings[start + i] = batchResult[i];
    }
  }

  return allEmbeddings;
}

async function fetchEmbeddingBatch(
  texts: string[],
  cfg: typeof EMBEDDING_FILTER_CONFIG,
): Promise<number[][]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const resp = await fetch(`${cfg.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        input: texts,
        dimensions: cfg.dimension,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Embedding API error ${resp.status}: ${body}`);
    }

    const json = (await resp.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    const sorted = json.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  } finally {
    clearTimeout(timer);
  }
}
