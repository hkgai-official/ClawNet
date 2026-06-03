// src/main/utils/text-extractor/rtfd.ts
//
// .rtfd is a macOS bundle directory. Convention: contains TXT.rtf as the
// main content file (plus optional images). We detect the directory and
// delegate to extractRtfFile for the inner TXT.rtf.

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { extractRtfFile } from './rtf';
import type { ExtractedText } from './text';

export async function extractRtfdFile(filePath: string, _fileSize: number): Promise<ExtractedText> {
  try {
    const info = await stat(filePath);
    if (!info.isDirectory()) return { text: null, format: 'rtfd' };
    const inner = join(filePath, 'TXT.rtf');
    const innerInfo = await stat(inner).catch(() => null);
    if (!innerInfo?.isFile()) return { text: null, format: 'rtfd' };
    const r = await extractRtfFile(inner, innerInfo.size);
    return { text: r.text, format: 'rtfd' };
  } catch {
    return { text: null, format: 'rtfd' };
  }
}
