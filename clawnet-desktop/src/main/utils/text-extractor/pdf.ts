// src/main/utils/text-extractor/pdf.ts
//
// PDF text extraction via pdf-parse (v2.x PDFParse class). Errors → null (graceful).

import { readFile } from 'node:fs/promises';
import type { PDFParse } from 'pdf-parse';
import type { ExtractedText } from './text';

// pdfjs-dist v5 (transitive dep of pdf-parse@2.4.5) references `DOMMatrix`
// at module top level. DOMMatrix is browser-only — eager `import` in
// the Electron main process crashes startup on Windows with
// "ReferenceError: DOMMatrix is not defined". Defer the load to actual
// PDF extraction so app boot stays clean. Process never touches PDFs
// during boot (file-search is invoked on demand from the renderer).
export async function extractPdfFile(filePath: string, _fileSize: number): Promise<ExtractedText> {
  let parser: PDFParse | null = null;
  try {
    const { PDFParse } = await import('pdf-parse');
    const buf = await readFile(filePath);
    parser = new PDFParse({ data: new Uint8Array(buf) });
    const parsed = await parser.getText();
    if (!parsed?.text) return { text: null, format: 'pdf' };
    return { text: parsed.text, format: 'pdf' };
  } catch {
    return { text: null, format: 'pdf' };
  } finally {
    await parser?.destroy().catch(() => {});
  }
}
