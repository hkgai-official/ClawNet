// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { GenericRichCard } from '../generic-rich-card';
import type { ChatMessage } from '../../../../../../shared/domain/chat';

beforeEach(() => cleanup());

function makeMessage(content: Record<string, unknown>): ChatMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    sender: { id: 'a1', name: 'Agent', type: 'agent' },
    contentType: 'rich_card',
    content: content as ChatMessage['content'],
    timestamp: '2026-05-15T00:00:00Z',
  };
}

describe('GenericRichCard', () => {
  it('renders name + text + url', () => {
    render(
      <GenericRichCard
        message={makeMessage({ name: 'Ref', text: 'some prose', url: 'https://example.test/x' })}
      />,
    );
    expect(screen.getByText('Ref')).toBeTruthy();
    expect(screen.getByText('some prose')).toBeTruthy();
    const link = screen.getByRole('link') as HTMLAnchorElement;
    expect(link.href).toBe('https://example.test/x');
  });

  it('execution_log mime → monospace <pre> block', () => {
    const { container } = render(
      <GenericRichCard message={makeMessage({ name: 'Log', text: '$ ls', mimeType: 'execution_log' })} />,
    );
    expect(container.querySelector('pre')).toBeTruthy();
  });

  it('non-monospace mime → plain div, no <pre>', () => {
    const { container } = render(
      <GenericRichCard message={makeMessage({ name: 'Note', text: 'hello', mimeType: 'reference_card' })} />,
    );
    expect(container.querySelector('pre')).toBeNull();
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('omits the name row when content has no name', () => {
    render(<GenericRichCard message={makeMessage({ text: 'just text' })} />);
    expect(screen.getByText('just text')).toBeTruthy();
  });
});
