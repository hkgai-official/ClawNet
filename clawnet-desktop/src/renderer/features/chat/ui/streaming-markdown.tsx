import { Markdown } from '../../../components/markdown';

/**
 * Thin alias kept for clarity at MessageBubble call sites. The work that
 * used to live here (split into blocks + memo per block) is now built
 * into `Markdown` itself, which also handles long-block sub-chunking.
 */
export function StreamingMarkdown({ content }: { content: string }) {
  return <Markdown content={content} />;
}
