// src/main/utils/text-extractor/index.ts
//
// Dispatcher: route a (filePath, ext, fileSize) to the right per-format
// extractor. Returns ExtractedText regardless of input (never throws).
// Unknown extensions fall through to the plain-text extractor.

import { extractPdfFile } from './pdf';
import { extractDocxFile } from './docx';
import { extractDocFile } from './doc';
import { extractRtfFile } from './rtf';
import { extractRtfdFile } from './rtfd';
import { extractHtmlFile } from './html';
import { extractTextFile } from './text';
import type { ExtractedText } from './text';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'heic']);

export async function extractText(
  filePath: string,
  ext: string,
  fileSize: number,
): Promise<ExtractedText> {
  const e = ext.toLowerCase();
  if (e === 'pdf') return extractPdfFile(filePath, fileSize);
  if (e === 'docx') return extractDocxFile(filePath, fileSize);
  if (e === 'doc') return extractDocFile(filePath, fileSize);
  if (e === 'rtf') return extractRtfFile(filePath, fileSize);
  if (e === 'rtfd') return extractRtfdFile(filePath, fileSize);
  if (e === 'html' || e === 'htm') return extractHtmlFile(filePath, fileSize);
  if (IMAGE_EXTS.has(e)) return { text: null, format: 'image' };
  return extractTextFile(filePath, fileSize);
}

export type { ExtractedText };
