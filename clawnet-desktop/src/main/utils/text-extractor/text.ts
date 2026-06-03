// src/main/utils/text-extractor/text.ts
//
// Reads UTF-8 text from a file. For files ≤ 512 KB, returns the whole
// content. For larger files, returns head 256 KB + a marker + tail 256 KB.
// Mirrors macOS FileSearchHandler.swift:214-232.

import { open } from 'node:fs/promises';

const CHUNK = 256 * 1024; // textSearchChunkBytes (macOS FileSearchHandler.swift:18)

export interface ExtractedText {
  text: string | null;
  format: string;
}

export async function extractTextFile(filePath: string, fileSize: number): Promise<ExtractedText> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(filePath, 'r');
    if (fileSize <= CHUNK * 2) {
      const buf = Buffer.alloc(fileSize);
      await handle.read(buf, 0, fileSize, 0);
      const text = bufferToUtf8(buf);
      if (text === null) return { text: null, format: 'binary' };
      return { text, format: 'text' };
    }
    const headBuf = Buffer.alloc(CHUNK);
    await handle.read(headBuf, 0, CHUNK, 0);
    const headText = bufferToUtf8(headBuf);
    if (headText === null) return { text: null, format: 'binary' };

    const tailBuf = Buffer.alloc(CHUNK);
    await handle.read(tailBuf, 0, CHUNK, fileSize - CHUNK);
    const tailText = bufferToUtf8(tailBuf) ?? '';

    return { text: `${headText}\n…\n${tailText}`, format: 'text' };
  } catch {
    return { text: null, format: 'binary' };
  } finally {
    await handle?.close();
  }
}

function bufferToUtf8(buf: Buffer): string | null {
  const decoded = buf.toString('utf-8');
  if (decoded.length === 0) return decoded;
  const replacementCount = (decoded.match(/�/g) ?? []).length;
  if (replacementCount / decoded.length > 0.05) return null;
  return decoded;
}
