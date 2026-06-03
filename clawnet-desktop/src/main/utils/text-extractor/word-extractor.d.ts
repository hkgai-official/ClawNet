// Minimal ambient typings for `word-extractor` (no upstream @types package).
// API surface used by doc.ts: `new WordExtractor().extract(path) → Promise<Document>`
// and `Document.getBody() → string`. See node_modules/word-extractor/lib/word.js.

declare module 'word-extractor' {
  class WordExtractorDocument {
    getBody(): string;
    getFootnotes(): string;
    getHeaders(): string;
    getFooters(): string;
    getAnnotations(): string;
    getEndnotes(): string;
    getTextboxes(): string;
  }

  class WordExtractor {
    constructor();
    extract(source: string | Buffer): Promise<WordExtractorDocument>;
  }

  export default WordExtractor;
}
