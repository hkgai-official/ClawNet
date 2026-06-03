import { EMBEDDING_FILTER_CONFIG } from "./config.js";
import type { AnyMessage } from "./chunker.js";
import { chunkMessages, splitSystemPrompt } from "./chunker.js";
import { getEmbeddings } from "./embedding-api.js";
import { cosineSimilarity } from "./similarity.js";

export type ChunkDetail = {
  index: number;
  similarity: number | null; // null = protected, not scored
  kept: boolean;
  protected: boolean;
  chars: number;
  preview: string; // first 80 chars
};

export type SectionDetail = {
  index: number;
  title: string;
  similarity: number | null;
  kept: boolean;
  protected: boolean;
  chars: number;
};

export type FilterResult = {
  filteredMessages: AnyMessage[];
  filteredSystemPrompt: string;
  stats: {
    totalMessageChunks: number;
    keptMessageChunks: number;
    removedMessageChunks: number;
    totalSystemSections: number;
    keptSystemSections: number;
    removedSystemSections: number;
    // debug details
    query: string;
    threshold: number;
    originalCharsMessages: number;
    filteredCharsMessages: number;
    originalCharsSystem: number;
    filteredCharsSystem: number;
    messageChunkDetails: ChunkDetail[];
    systemSectionDetails: SectionDetail[];
  };
};

/**
 * Filter conversation messages and system prompt sections by embedding
 * similarity to the user's current prompt.
 *
 * Returns null if filtering is skipped (disabled, no API key, too few messages, etc.).
 * On API error, returns null so the original context is used unmodified.
 */
export async function filterContext(params: {
  userPrompt: string;
  messages: AnyMessage[];
  systemPromptText: string;
}): Promise<FilterResult | null> {
  const cfg = EMBEDDING_FILTER_CONFIG;

  // --- Guard: should we filter? ---
  if (!cfg.enabled || !cfg.apiKey) return null;
  if (params.messages.length < cfg.minMessagesForFilter) return null;

  try {
    // --- 1. Chunk messages ---
    const messageChunks = chunkMessages(params.messages);

    // --- 2. Split system prompt ---
    const systemSections = splitSystemPrompt(params.systemPromptText);

    // --- 3. Collect texts that need embedding ---
    // We need embeddings for: user prompt + unprotected message chunks + unprotected system sections
    const textsToEmbed: string[] = [params.userPrompt]; // index 0 = query
    const messageChunkMapping: Array<{ chunkIndex: number; embedIndex: number }> = [];
    const systemSectionMapping: Array<{ sectionIndex: number; embedIndex: number }> = [];

    for (let ci = 0; ci < messageChunks.length; ci++) {
      const chunk = messageChunks[ci];
      if (chunk.protected || !chunk.text.trim()) continue;
      messageChunkMapping.push({ chunkIndex: ci, embedIndex: textsToEmbed.length });
      textsToEmbed.push(chunk.text);
    }

    for (let si = 0; si < systemSections.length; si++) {
      const section = systemSections[si];
      if (section.protected || !section.text.trim()) continue;
      systemSectionMapping.push({ sectionIndex: si, embedIndex: textsToEmbed.length });
      textsToEmbed.push(section.text);
    }

    // If everything is protected, nothing to filter
    if (messageChunkMapping.length === 0 && systemSectionMapping.length === 0) {
      return null;
    }

    // --- 4. Batch call embedding API ---
    const embeddings = await getEmbeddings(textsToEmbed);
    const queryEmbedding = embeddings[0];

    // --- 5. Score and filter message chunks ---
    const removedChunkIndices = new Set<number>();
    const chunkScores = new Map<number, number>(); // chunkIndex -> similarity
    for (const { chunkIndex, embedIndex } of messageChunkMapping) {
      const sim = cosineSimilarity(queryEmbedding, embeddings[embedIndex]);
      chunkScores.set(chunkIndex, sim);
      if (sim < cfg.similarityThreshold) {
        removedChunkIndices.add(chunkIndex);
      }
    }

    // Collect kept message indices (preserving original order)
    const keptMessageIndices = new Set<number>();
    for (let ci = 0; ci < messageChunks.length; ci++) {
      if (removedChunkIndices.has(ci)) continue;
      for (const idx of messageChunks[ci].indices) {
        keptMessageIndices.add(idx);
      }
    }
    const filteredMessages = params.messages.filter((_, i) => keptMessageIndices.has(i));

    // --- 6. Score and filter system prompt sections ---
    const removedSectionIndices = new Set<number>();
    const sectionScores = new Map<number, number>(); // sectionIndex -> similarity
    for (const { sectionIndex, embedIndex } of systemSectionMapping) {
      const sim = cosineSimilarity(queryEmbedding, embeddings[embedIndex]);
      sectionScores.set(sectionIndex, sim);
      if (sim < cfg.similarityThreshold) {
        removedSectionIndices.add(sectionIndex);
      }
    }
    const filteredSystemPrompt = systemSections
      .filter((_, i) => !removedSectionIndices.has(i))
      .map((s) => s.text)
      .join("\n");

    // --- 7. Build detailed stats ---
    const totalMC = messageChunks.length;
    const removedMC = removedChunkIndices.size;
    const totalSS = systemSections.length;
    const removedSS = removedSectionIndices.size;

    // Character counts
    const originalCharsMessages = params.messages
      .map((m) => JSON.stringify(m.content ?? "").length)
      .reduce((a, b) => a + b, 0);
    const filteredCharsMessages = filteredMessages
      .map((m) => JSON.stringify(m.content ?? "").length)
      .reduce((a, b) => a + b, 0);
    const originalCharsSystem = params.systemPromptText.length;
    const filteredCharsSystem = filteredSystemPrompt.length;

    // Per-chunk details
    const messageChunkDetails: ChunkDetail[] = messageChunks.map((chunk, ci) => ({
      index: ci,
      similarity: chunkScores.get(ci) ?? null,
      kept: !removedChunkIndices.has(ci),
      protected: chunk.protected,
      chars: chunk.text.length,
      preview: chunk.text.slice(0, 80).replace(/\n/g, "\\n"),
    }));

    // Per-section details
    const systemSectionDetails: SectionDetail[] = systemSections.map((sec, si) => ({
      index: si,
      title: sec.title || "(preamble)",
      similarity: sectionScores.get(si) ?? null,
      kept: !removedSectionIndices.has(si),
      protected: sec.protected,
      chars: sec.text.length,
    }));

    // --- 8. Log debug details ---
    const tag = "[embedding-filter]";
    // Dump full content for debugging
    console.log(
      `${tag} [DUMP-ORIGINAL-SYSTEM-START]\n${params.systemPromptText}\n${tag} [DUMP-ORIGINAL-SYSTEM-END]`,
    );
    console.log(
      `${tag} [DUMP-FILTERED-SYSTEM-START]\n${filteredSystemPrompt}\n${tag} [DUMP-FILTERED-SYSTEM-END]`,
    );
    console.log(
      `${tag} [DUMP-ORIGINAL-MESSAGES-START]\n${params.messages.map((m, i) => `[${i}:${m.role}] ${JSON.stringify(m.content ?? "").slice(0, 500)}`).join("\n")}\n${tag} [DUMP-ORIGINAL-MESSAGES-END]`,
    );
    console.log(
      `${tag} [DUMP-FILTERED-MESSAGES-START]\n${filteredMessages.map((m, i) => `[${i}:${m.role}] ${JSON.stringify(m.content ?? "").slice(0, 500)}`).join("\n")}\n${tag} [DUMP-FILTERED-MESSAGES-END]`,
    );
    console.log(`${tag} query: "${params.userPrompt.slice(0, 100)}"`);
    console.log(`${tag} threshold: ${cfg.similarityThreshold}`);
    console.log(
      `${tag} messages: ${originalCharsMessages} → ${filteredCharsMessages} chars ` +
        `(saved ${originalCharsMessages - filteredCharsMessages}, ${totalMC - removedMC}/${totalMC} chunks kept)`,
    );
    console.log(
      `${tag} system: ${originalCharsSystem} → ${filteredCharsSystem} chars ` +
        `(saved ${originalCharsSystem - filteredCharsSystem}, ${totalSS - removedSS}/${totalSS} sections kept)`,
    );
    console.log(`${tag} --- message chunks ---`);
    for (const d of messageChunkDetails) {
      const status = d.protected ? "PROTECTED" : d.kept ? "KEPT" : "REMOVED";
      const simStr = d.similarity !== null ? d.similarity.toFixed(4) : "n/a";
      console.log(
        `${tag}   [${d.index}] sim=${simStr} ${status} (${d.chars} chars) "${d.preview}"`,
      );
    }
    console.log(`${tag} --- system sections ---`);
    for (const d of systemSectionDetails) {
      const status = d.protected ? "PROTECTED" : d.kept ? "KEPT" : "REMOVED";
      const simStr = d.similarity !== null ? d.similarity.toFixed(4) : "n/a";
      console.log(
        `${tag}   [${d.index}] sim=${simStr} ${status} (${d.chars} chars) title="${d.title}"`,
      );
    }

    return {
      filteredMessages,
      filteredSystemPrompt,
      stats: {
        totalMessageChunks: totalMC,
        keptMessageChunks: totalMC - removedMC,
        removedMessageChunks: removedMC,
        totalSystemSections: totalSS,
        keptSystemSections: totalSS - removedSS,
        removedSystemSections: removedSS,
        query: params.userPrompt.slice(0, 200),
        threshold: cfg.similarityThreshold,
        originalCharsMessages,
        filteredCharsMessages,
        originalCharsSystem,
        filteredCharsSystem,
        messageChunkDetails,
        systemSectionDetails,
      },
    };
  } catch (err) {
    // On any error (network, timeout, parse), skip filtering silently
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[embedding-filter] skipped due to error: ${errMsg}`);
    return null;
  }
}
