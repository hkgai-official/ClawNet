// src/main/utils/text-extractor/html.ts
//
// Strips HTML to plain text via node-html-parser. Errors return null
// + format=html (don't crash on malformed input).

import { readFile } from 'node:fs/promises';
import { parse } from 'node-html-parser';
import type { ExtractedText } from './text';

export async function extractHtmlFile(filePath: string, _fileSize: number): Promise<ExtractedText> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const root = parse(raw);
    const text = root.text;
    if (!text) return { text: null, format: 'html' };
    return { text, format: 'html' };
  } catch {
    return { text: null, format: 'html' };
  }
}
