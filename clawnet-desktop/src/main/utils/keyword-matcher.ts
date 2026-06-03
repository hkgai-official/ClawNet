// src/main/utils/keyword-matcher.ts
//
// Two-stage keyword matcher: filename first, then content via injected
// extractor. Mirrors macOS FileSearchHandler.swift:136-170.

export interface ExtractedText {
  text: string | null;
  format: string;
}

export interface KeywordMatchResult {
  hits: string[];
  format: string;
  text: string | null;
}

export interface KeywordMatcherDeps {
  extractText: (filePath: string, ext: string, fileSize: number) => Promise<ExtractedText>;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'heic']);

function formatForExt(ext: string): string {
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return 'text';
}

export async function matchKeywords(
  filePath: string,
  fileName: string,
  ext: string,
  fileSize: number,
  keywordsLower: string[],
  deps: KeywordMatcherDeps,
): Promise<KeywordMatchResult> {
  const nameLower = fileName.toLowerCase();
  const nameHits: string[] = [];
  const remaining: string[] = [];
  for (const kw of keywordsLower) {
    if (nameLower.includes(kw)) nameHits.push(kw);
    else remaining.push(kw);
  }

  if (remaining.length === 0) {
    return { hits: nameHits, format: formatForExt(ext), text: null };
  }

  const extracted = await deps.extractText(filePath, ext, fileSize);
  if (extracted.text === null) {
    return { hits: nameHits, format: extracted.format, text: null };
  }

  const textLower = extracted.text.toLowerCase();
  const contentHits: string[] = [];
  for (const kw of remaining) {
    if (textLower.includes(kw)) contentHits.push(kw);
  }

  const allHits = [...nameHits, ...contentHits];
  return {
    hits: allHits,
    format: extracted.format,
    text: allHits.length === 0 ? null : extracted.text,
  };
}
