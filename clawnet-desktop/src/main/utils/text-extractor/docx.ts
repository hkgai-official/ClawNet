// src/main/utils/text-extractor/docx.ts
//
// DOCX text extraction via mammoth. Errors → null (graceful).

import * as mammoth from 'mammoth';
import type { ExtractedText } from './text';

export async function extractDocxFile(filePath: string, _fileSize: number): Promise<ExtractedText> {
  try {
    const r = await mammoth.extractRawText({ path: filePath });
    if (!r.value) return { text: null, format: 'docx' };
    return { text: r.value, format: 'docx' };
  } catch {
    return { text: null, format: 'docx' };
  }
}
