// src/main/utils/text-extractor/doc.ts
//
// Legacy .doc (binary CFB). word-extractor is a pure-JS parser that
// handles common .doc layouts but not every CFB variant. Failures
// return null gracefully — agents searching .doc files will see the
// filename match but no content match for unparseable variants.

import WordExtractor from 'word-extractor';
import type { ExtractedText } from './text';

export async function extractDocFile(filePath: string, _fileSize: number): Promise<ExtractedText> {
  try {
    const extractor = new WordExtractor();
    const doc = await extractor.extract(filePath);
    const body = doc.getBody();
    if (!body) return { text: null, format: 'doc' };
    return { text: body, format: 'doc' };
  } catch {
    return { text: null, format: 'doc' };
  }
}
