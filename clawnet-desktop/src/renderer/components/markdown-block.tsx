// Memo-wrapped Markdown. Kept as a thin re-export for any external
// callers that already import `MarkdownBlock`; the `Markdown` component
// itself now performs the per-chunk memoization, so a direct
// `<Markdown content=... />` is equally efficient.

import { memo } from 'react';
import { Markdown } from './markdown';

export interface MarkdownBlockProps {
  content: string;
}

export const MarkdownBlock = memo(
  function MarkdownBlock({ content }: MarkdownBlockProps) {
    return <Markdown content={content} />;
  },
  (prev, next) => prev.content === next.content,
);
