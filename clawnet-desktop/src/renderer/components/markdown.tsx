import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { chunkLongBlocks, splitMarkdownBlocks } from '../../shared/markdown-splitter';

export interface MarkdownProps {
  content: string;
}

/**
 * Public Markdown renderer. Splits content into paragraph-/fence-bounded
 * blocks, then sub-chunks any block longer than 3000 chars into ~1500-char
 * pieces. Each chunk renders through `MemoChunk` so re-renders (e.g. when
 * streaming appends to the tail) only recompute the chunks that changed.
 */
export function Markdown({ content }: MarkdownProps) {
  const chunks = useMemo(
    () => chunkLongBlocks(splitMarkdownBlocks(content)),
    [content],
  );
  // Single-chunk fast path: skip the wrapping map for the common short-
  // message case so we don't pay the array overhead on every message.
  if (chunks.length <= 1) {
    return (
      <div className="prose-sm">
        <MarkdownChunk content={chunks[0] ?? ''} />
      </div>
    );
  }
  return (
    <div className="prose-sm">
      {chunks.map((c, i) => (
        <MemoChunk key={i} content={c} />
      ))}
    </div>
  );
}

const MemoChunk = memo(
  function MemoChunk({ content }: { content: string }) {
    return <MarkdownChunk content={content} />;
  },
  (prev, next) => prev.content === next.content,
);

function MarkdownChunk({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      // rehype-highlight applies hljs class names to <code> blocks with a
      // language fence (e.g. ```ts). We pair it with the github-dark
      // theme — both dark and light app themes look fine since our chat
      // bubbles already lean on a dark inline-code background.
      rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      components={{
        a: ({ node: _n, ...props }) => <a target="_blank" rel="noreferrer" {...props} />,
        code: ({ node: _n, className, children, ...props }) => {
          const isBlock = className?.includes('language-');
          if (isBlock) {
            return (
              <code
                {...props}
                className={className}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85em',
                }}
              >
                {children}
              </code>
            );
          }
          return (
            <code
              {...props}
              style={{
                background: 'var(--color-bg-surface-2)',
                padding: '0 4px',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.9em',
              }}
            >
              {children}
            </code>
          );
        },
        pre: ({ node: _n, ...props }) => (
          <pre
            {...props}
            style={{
              background: 'var(--color-bg-surface-2)',
              padding: '8px 10px',
              borderRadius: 'var(--radius-md)',
              overflowX: 'auto',
              maxWidth: '100%',
              margin: '6px 0',
            }}
          />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
