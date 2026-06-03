// Splits Markdown into top-level block strings without depending on a
// Markdown parser — works on raw text by tracking blank lines and code-fence state.
// Robust for streaming inputs that end mid-block.

export function splitMarkdownBlocks(md: string): string[] {
  if (!md) return [];
  const lines = md.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const isFenceLine = /^```/.test(line);
    if (isFenceLine) {
      inFence = !inFence;
      current.push(line);
      continue;
    }
    if (inFence) {
      current.push(line);
      continue;
    }
    if (line.trim() === '') {
      if (current.length > 0) {
        blocks.push(current.join('\n'));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join('\n'));
  return blocks;
}

/**
 * Cap for a single Markdown block before we sub-chunk it. Single bubbles
 * with one massive paragraph (LLM dumps, pasted logs) tank ReactMarkdown
 * + rehype-highlight render time; sub-chunking keeps the memoized
 * `MarkdownBlock` cache useful. Exported so tests + downstream tuning
 * can reference them without copy-pasting magic numbers.
 */
export const LONG_BLOCK_THRESHOLD = 3000;
export const TARGET_CHUNK_SIZE = 1500;

/**
 * If a block exceeds LONG_BLOCK_THRESHOLD chars, slice it into chunks
 * around TARGET_CHUNK_SIZE. Code fences are never split (perf < safety:
 * a code block sliced mid-fence renders as broken inline code). Other
 * blocks are split preferring sentence ends, then newlines, then spaces,
 * so we don't fracture words mid-token.
 */
export function chunkLongBlocks(blocks: string[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.length <= LONG_BLOCK_THRESHOLD) {
      out.push(block);
      continue;
    }
    // Code fences are atomic; don't slice them up. Even a partial fence
    // (streaming case) stays whole until the closing ``` arrives.
    if (block.startsWith('```')) {
      out.push(block);
      continue;
    }
    out.push(...sliceTextBlock(block));
  }
  return out;
}

/**
 * Slice a long plain-prose block into ~TARGET_CHUNK_SIZE chunks. Prefers
 * to break at sentence boundaries (. ! ? followed by space), falling
 * back to line breaks, then any whitespace, then a hard cut.
 */
function sliceTextBlock(text: string): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const remaining = text.length - i;
    if (remaining <= TARGET_CHUNK_SIZE * 1.25) {
      // Last chunk: take the rest rather than producing a tiny tail.
      chunks.push(text.slice(i));
      break;
    }
    // Look in a window around TARGET for a clean break. The window starts
    // at TARGET*0.75 and ends at TARGET*1.25, so chunks stay within
    // ±25% of target size.
    const windowStart = i + Math.floor(TARGET_CHUNK_SIZE * 0.75);
    const windowEnd = i + Math.floor(TARGET_CHUNK_SIZE * 1.25);
    const breakAt =
      findLastBreak(text, windowStart, windowEnd, /[.!?][\s\n]/) ??
      findLastBreak(text, windowStart, windowEnd, /\n/) ??
      findLastBreak(text, windowStart, windowEnd, /\s/) ??
      windowEnd;
    chunks.push(text.slice(i, breakAt + 1));
    i = breakAt + 1;
  }
  return chunks;
}

/** Find the last match of `pattern` in text[from..to]. Returns the index
 *  of the matched character (the one BEFORE the natural break), or null
 *  if no match exists in the window. Cheap linear scan — markdown
 *  chunks aren't long enough to justify anything fancier. */
function findLastBreak(
  text: string,
  from: number,
  to: number,
  pattern: RegExp,
): number | null {
  const slice = text.slice(from, Math.min(to, text.length));
  let lastIdx = -1;
  // Iterate via exec to find the last match without splitting.
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) !== null) {
    lastIdx = m.index;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  if (lastIdx < 0) return null;
  return from + lastIdx;
}
