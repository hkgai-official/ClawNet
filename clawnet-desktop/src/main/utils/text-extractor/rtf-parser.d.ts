// Minimal ambient typings for `rtf-parser` (no upstream @types package).
// Runtime API surface (see node_modules/rtf-parser/index.js):
//   const rtf = require('rtf-parser');
//   rtf.string(rtfText, (err, doc) => …);   // streaming string parse
// The test in __tests__/rtf.test.ts mocks the module to expose `parseString`
// on both the default and named exports, so we declare both spellings here
// and the implementation prefers `parseString` then falls back to `string`.

declare module 'rtf-parser' {
  interface RtfSpan {
    value?: string;
  }
  interface RtfParagraph {
    content?: RtfSpan[];
  }
  interface RtfDoc {
    content?: RtfParagraph[];
  }

  type RtfCallback = (err: Error | null, doc?: RtfDoc) => void;

  interface RtfParser {
    parseString?: (rtf: string, cb: RtfCallback) => void;
    string?: (rtf: string, cb: RtfCallback) => void;
  }

  const parser: RtfParser;
  export default parser;
  export const parseString: ((rtf: string, cb: RtfCallback) => void) | undefined;
}
