// src/main/utils/text-extractor/rtf.ts
//
// .rtf via rtf-parser. The library has a streaming callback API which we
// promisify, then flatten the doc tree (paragraphs of spans) into
// newline-joined plain text. Parse failures or empty bodies return null
// so callers fall back to filename-only matching.

import { readFile } from 'node:fs/promises';
import rtfParser from 'rtf-parser';
import type { ExtractedText } from './text';

interface RtfSpan {
  value?: string;
}
interface RtfParagraph {
  content?: RtfSpan[];
  value?: string;
}
interface RtfDoc {
  content?: RtfParagraph[];
}

export async function extractRtfFile(filePath: string, _fileSize: number): Promise<ExtractedText> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    // Real runtime exposes `.string(text, cb)`; the test mock exposes
    // `.parseString(text, cb)`. Accept either spelling.
    const parseFn = rtfParser.parseString ?? rtfParser.string;
    if (typeof parseFn !== 'function') return { text: null, format: 'rtf' };
    const doc = await new Promise<RtfDoc | null>((resolve) => {
      parseFn(raw, (err: Error | null, d?: RtfDoc) => {
        if (err) resolve(null);
        else resolve(d ?? null);
      });
    });
    if (!doc) return { text: null, format: 'rtf' };
    const paragraphs = (doc.content ?? []).map((p) => {
      // rtf-parser sometimes emits a paragraph as a span container with
      // `.content[]`, sometimes as a bare span with a direct `.value`.
      if (p.content && p.content.length > 0) {
        return p.content.map((s) => s.value ?? '').join('');
      }
      return p.value ?? '';
    });
    const text = paragraphs.join('\n').trim();
    if (!text) return { text: null, format: 'rtf' };
    return { text, format: 'rtf' };
  } catch {
    return { text: null, format: 'rtf' };
  }
}
