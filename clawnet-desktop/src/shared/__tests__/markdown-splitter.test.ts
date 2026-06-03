import { describe, it, expect } from 'vitest';
import { chunkLongBlocks, splitMarkdownBlocks } from '../markdown-splitter';

describe('splitMarkdownBlocks', () => {
  it('returns single block for one paragraph', () => {
    expect(splitMarkdownBlocks('hello world')).toEqual(['hello world']);
  });

  it('splits paragraphs by blank line', () => {
    const md = 'first paragraph\n\nsecond paragraph';
    expect(splitMarkdownBlocks(md)).toEqual(['first paragraph', 'second paragraph']);
  });

  it('keeps fenced code blocks intact', () => {
    const md = 'before\n\n```ts\nconst x = 1;\nconst y = 2;\n```\n\nafter';
    const blocks = splitMarkdownBlocks(md);
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toContain('```ts');
    expect(blocks[1]).toContain('```');
  });

  it('treats list as one block (consecutive lines starting with - or *)', () => {
    const md = '- item one\n- item two\n- item three';
    expect(splitMarkdownBlocks(md)).toEqual([md]);
  });

  it('treats headings as their own block', () => {
    const md = '# Title\n\npara';
    expect(splitMarkdownBlocks(md)).toEqual(['# Title', 'para']);
  });

  it('handles empty input', () => {
    expect(splitMarkdownBlocks('')).toEqual([]);
  });

  it('handles incomplete fenced block at end (streaming case)', () => {
    const md = 'before\n\n```ts\nconst x = ';
    const blocks = splitMarkdownBlocks(md);
    expect(blocks[blocks.length - 1]).toContain('```ts');
    expect(blocks[blocks.length - 1]).toContain('const x =');
  });
});

describe('chunkLongBlocks', () => {
  it('passes short blocks through unchanged', () => {
    const input = ['short', 'paragraph here'];
    expect(chunkLongBlocks(input)).toEqual(input);
  });

  it('splits a >3000-char block into ~1500-char chunks', () => {
    // Build sentences separated by ". " — ensures break-on-sentence works.
    const sentence = 'lorem ipsum dolor sit amet consectetur adipiscing elit. ';
    const long = sentence.repeat(80); // ~80 * 56 = 4480 chars
    const out = chunkLongBlocks([long]);
    expect(out.length).toBeGreaterThan(1);
    // No chunk should be insanely large (>=2000 chars) — should land near 1500.
    for (const c of out) expect(c.length).toBeLessThan(2200);
    // Concatenation must equal the original (no content lost).
    expect(out.join('')).toBe(long);
  });

  it('does not split code-fenced blocks even when very long', () => {
    const fence = '```ts\n' + 'const x = 1;\n'.repeat(400) + '```';
    expect(fence.length).toBeGreaterThan(3000);
    expect(chunkLongBlocks([fence])).toEqual([fence]);
  });

  it('keeps a single moderately long block intact (below threshold)', () => {
    const text = 'a'.repeat(2999);
    expect(chunkLongBlocks([text])).toEqual([text]);
  });
});
