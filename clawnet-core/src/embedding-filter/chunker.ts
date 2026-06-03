import { EMBEDDING_FILTER_CONFIG } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A generic message with at least role + content. */
export type AnyMessage = {
  role: string;
  content?: unknown;
  [key: string]: unknown;
};

/** A logical group of messages that should be kept or removed together. */
export type MessageChunk = {
  /** Indices into the original messages array */
  indices: number[];
  /** Concatenated text for embedding computation */
  text: string;
  /** Whether this chunk must always be kept (e.g. recent rounds) */
  protected: boolean;
};

/** A section of the system prompt, split by ## heading. */
export type SystemPromptSection = {
  /** The raw text of this section (including heading) */
  text: string;
  /** The heading title (lowercase), or "" for the preamble before any heading */
  title: string;
  /** Whether this section is always kept */
  protected: boolean;
};

// ---------------------------------------------------------------------------
// Message chunking (RAG-style)
// ---------------------------------------------------------------------------

/** Target chunk size in characters */
const MSG_CHUNK_SIZE = 500;
/** Overlap between adjacent chunks */
const MSG_CHUNK_OVERLAP = 100;

/**
 * Extract the text content from a message for embedding computation.
 */
function extractMessageText(msg: AnyMessage): string {
  const content = msg.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object") {
      const typed = block as { type?: string; text?: string; name?: string; input?: unknown };
      if (typeof typed.text === "string") {
        parts.push(typed.text);
      } else if (typed.type === "tool_use" && typed.name) {
        parts.push(`[tool: ${typed.name}] ${JSON.stringify(typed.input ?? "").slice(0, 200)}`);
      }
    }
  }
  return parts.join("\n");
}

/**
 * A segment of flattened text that maps back to a specific message index.
 */
type TextSegment = { msgIndex: number; start: number; end: number };

/**
 * RAG-style message chunking.
 *
 * 1. Flatten all messages into one long text, tracking each character's message index.
 * 2. Split into fixed-size overlapping chunks (~500 chars, ~100 overlap).
 * 3. Each chunk records which message indices it covers.
 * 4. Recent N rounds are marked as protected.
 *
 * When filtering: a message is kept if ANY chunk covering it is kept.
 */
export function chunkMessages(messages: AnyMessage[]): MessageChunk[] {
  const cfg = EMBEDDING_FILTER_CONFIG;

  if (messages.length === 0) return [];

  // --- Step 1: determine protected message indices (recent N rounds) ---
  const roundStarts: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") {
      roundStarts.push(i);
    }
  }
  const protectedFrom =
    roundStarts.length <= cfg.recentRoundsToKeep
      ? 0
      : roundStarts[roundStarts.length - cfg.recentRoundsToKeep];

  // --- Step 2: flatten messages into one text with index mapping ---
  let fullText = "";
  const segments: TextSegment[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const roleLabel =
      msg.role === "user"
        ? "[user] "
        : msg.role === "assistant"
          ? "[assistant] "
          : `[${msg.role}] `;
    const msgText = roleLabel + extractMessageText(msg);

    const start = fullText.length;
    fullText += (i > 0 ? "\n" : "") + msgText;
    const end = fullText.length;

    segments.push({ msgIndex: i, start, end });
  }

  // --- Step 3: create overlapping chunks ---
  const chunks: MessageChunk[] = [];
  let pos = 0;

  while (pos < fullText.length) {
    const chunkEnd = Math.min(pos + MSG_CHUNK_SIZE, fullText.length);
    const chunkText = fullText.slice(pos, chunkEnd);

    // Find which messages this chunk overlaps with
    const coveredIndices = new Set<number>();
    for (const seg of segments) {
      // Chunk [pos, chunkEnd) overlaps with segment [seg.start, seg.end)?
      if (seg.start < chunkEnd && seg.end > pos) {
        coveredIndices.add(seg.msgIndex);
      }
    }

    const indices = [...coveredIndices].sort((a, b) => a - b);
    const isProtected = indices.some((idx) => idx >= protectedFrom);

    chunks.push({
      indices,
      text: chunkText,
      protected: isProtected,
    });

    // Advance by (chunk_size - overlap), but at least 1 char to avoid infinite loop
    const step = Math.max(MSG_CHUNK_SIZE - MSG_CHUNK_OVERLAP, 1);
    if (chunkEnd >= fullText.length) break;
    pos += step;
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// System prompt sectioning
// ---------------------------------------------------------------------------

/** Sections smaller than this are merged with neighbors to avoid noisy embeddings */
const MIN_SECTION_CHARS = 80;
/** Sections larger than this are split further */
const MAX_SECTION_CHARS = 800;

export function splitSystemPrompt(systemPrompt: string): SystemPromptSection[] {
  if (!systemPrompt) return [];

  const cfg = EMBEDDING_FILTER_CONFIG;
  const coreTitles = new Set(cfg.coreSystemSections.map((s) => s.toLowerCase()));

  function isCoreTitle(title: string): boolean {
    if (title === "") return true; // preamble always kept
    return coreTitles.has(title) || [...coreTitles].some((core) => title.includes(core));
  }

  // --- Pass 1: split by any markdown heading (#{1,4}) ---
  const rawSections: Array<{ title: string; text: string; headingLevel: number }> = [];
  const lines = systemPrompt.split("\n");
  let currentTitle = "";
  let currentLevel = 0;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLines.length === 0) return;
    rawSections.push({
      title: currentTitle,
      text: currentLines.join("\n"),
      headingLevel: currentLevel,
    });
    currentLines = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentLevel = headingMatch[1].length;
      currentTitle = headingMatch[2].trim().toLowerCase();
      currentLines.push(line);
    } else {
      currentLines.push(line);
    }
  }
  flush();

  // --- Pass 2: handle workspace file sections ---
  // Pattern: "## /path/to/file.md" (just a path, protected) followed by content sections.
  // Merge the path header into the first content section so they stay together.
  const merged: typeof rawSections = [];
  for (let i = 0; i < rawSections.length; i++) {
    const sec = rawSections[i];
    const isFilePath = sec.title.startsWith("/") && sec.text.trim().length < 200;
    if (isFilePath && i + 1 < rawSections.length) {
      // Merge path line into next section's text
      const next = rawSections[i + 1];
      merged.push({
        title: next.title,
        text: sec.text + "\n" + next.text,
        headingLevel: next.headingLevel,
      });
      i++; // skip next, already merged
    } else {
      merged.push(sec);
    }
  }

  // --- Pass 3: split oversized, merge undersized, handle special patterns ---
  const expanded: SystemPromptSection[] = [];

  for (const raw of merged) {
    const isCore = isCoreTitle(raw.title);

    if (isCore) {
      expanded.push({ text: raw.text, title: raw.title, protected: true });
    } else if (raw.text.includes("<skill>")) {
      // Split by <skill>...</skill> blocks
      expanded.push(...splitBySkillBlocks(raw.text, raw.title));
    } else if (raw.text.length > MAX_SECTION_CHARS) {
      // Split oversized sections by blank-line paragraphs
      const chunks = splitIntoParagraphs(raw.text, MAX_SECTION_CHARS);
      for (let pi = 0; pi < chunks.length; pi++) {
        const pTitle =
          chunks.length === 1 ? raw.title : `${raw.title} (${pi + 1}/${chunks.length})`;
        expanded.push({ text: chunks[pi], title: pTitle, protected: false });
      }
    } else {
      expanded.push({ text: raw.text, title: raw.title, protected: false });
    }
  }

  // --- Pass 4: merge tiny adjacent non-protected sections ---
  // Sections < MIN_SECTION_CHARS get merged with the next non-protected section
  const sections: SystemPromptSection[] = [];
  let pendingTiny = "";
  let pendingTitle = "";

  for (const sec of expanded) {
    if (sec.protected) {
      // Flush any pending tiny text as its own section before the protected one
      if (pendingTiny) {
        sections.push({ text: pendingTiny, title: pendingTitle, protected: false });
        pendingTiny = "";
        pendingTitle = "";
      }
      sections.push(sec);
    } else if (sec.text.length < MIN_SECTION_CHARS && !pendingTiny) {
      // Start accumulating tiny sections
      pendingTiny = sec.text;
      pendingTitle = sec.title;
    } else if (pendingTiny) {
      // Merge pending tiny into this section
      sections.push({
        text: pendingTiny + "\n" + sec.text,
        title: pendingTitle + " + " + sec.title,
        protected: false,
      });
      pendingTiny = "";
      pendingTitle = "";
    } else {
      sections.push(sec);
    }
  }
  // Flush any remaining tiny section
  if (pendingTiny) {
    sections.push({ text: pendingTiny, title: pendingTitle, protected: false });
  }

  return sections;
}

/**
 * Split a section containing <skill>...</skill> XML blocks.
 * - Header text (before <available_skills>) → one protected section (instructions)
 * - Each <skill>...</skill> block → one independent section
 */
function splitBySkillBlocks(text: string, parentTitle: string): SystemPromptSection[] {
  const sections: SystemPromptSection[] = [];

  const xmlStart = text.indexOf("<available_skills>");
  const xmlEnd = text.indexOf("</available_skills>");

  if (xmlStart === -1) {
    sections.push({ text, title: parentTitle, protected: false });
    return sections;
  }

  // Header: instructions before the skills list — keep as protected
  const header = text.slice(0, xmlStart).trim();
  if (header) {
    sections.push({ text: header, title: `${parentTitle} (instructions)`, protected: true });
  }

  // Extract individual <skill> blocks
  const xmlBody =
    xmlEnd > -1
      ? text.slice(xmlStart, xmlEnd + "</available_skills>".length)
      : text.slice(xmlStart);
  const skillRegex = /<skill>([\s\S]*?)<\/skill>/gi;
  let match: RegExpExecArray | null;

  while ((match = skillRegex.exec(xmlBody)) !== null) {
    const block = match[0];
    const nameMatch = block.match(/<name>\s*([^<]+?)\s*<\/name>/i);
    const skillName = nameMatch?.[1]?.trim() || "(unknown)";
    sections.push({
      text: block,
      title: `skill: ${skillName}`,
      protected: false,
    });
  }

  return sections;
}

/**
 * Split text into chunks, each up to maxChars.
 * Splits on blank lines first, then merges small paragraphs.
 */
function splitIntoParagraphs(text: string, maxChars: number): string[] {
  const lines = text.split("\n");
  const paragraphs: string[] = [];
  let current: string[] = [];

  const flushParagraph = () => {
    if (current.length === 0) return;
    paragraphs.push(current.join("\n"));
    current = [];
  };

  for (const line of lines) {
    if (line.trim() === "" && current.length > 0) {
      flushParagraph();
    } else {
      current.push(line);
    }
  }
  flushParagraph();

  // Merge small paragraphs into chunks up to maxChars
  const chunks: string[] = [];
  let buf = "";

  for (const p of paragraphs) {
    if (buf && buf.length + 1 + p.length > maxChars) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? buf + "\n\n" + p : p;
    }
  }
  if (buf) chunks.push(buf);

  return chunks;
}
