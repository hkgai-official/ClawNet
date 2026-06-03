// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

// jsdom doesn't implement scrollIntoView; the modal's selection effect
// calls it on the active result row.
Element.prototype.scrollIntoView = vi.fn();

const close = vi.fn();
let isOpen = true;
let searchResult: {
  messages: Array<{ id: string }>;
  contacts: Array<{ id: string }>;
  files: Array<{ id: string }>;
  isLoading: boolean;
  isError: boolean;
} = { messages: [], contacts: [], files: [], isLoading: false, isError: false };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts && 'defaultValue' in opts ? (opts.defaultValue as string) : k,
  }),
}));

vi.mock('../../state/global-search-slice', () => ({
  useGlobalSearchStore: (selector: (s: { isOpen: boolean; close: () => void }) => unknown) =>
    selector({ isOpen, close }),
}));

// Debounce passthrough — deterministic in tests.
vi.mock('../../hooks/use-debounced-value', () => ({
  useDebouncedValue: (v: string) => v,
}));

vi.mock('../../hooks/use-global-search', () => ({
  useGlobalSearch: () => searchResult,
}));

vi.mock('../result-section', () => ({
  ResultSection: ({ label, count, children }: { label: string; count: number; children: React.ReactNode }) =>
    count > 0 ? <div data-testid={`section-${label}`}>{children}</div> : null,
}));
vi.mock('../message-result-row', () => ({
  MessageResultRow: ({ message }: { message: { id: string } }) => <button>{message.id}</button>,
}));
vi.mock('../contact-result-row', () => ({
  ContactResultRow: ({ contact }: { contact: { id: string } }) => <button>{contact.id}</button>,
}));
vi.mock('../file-result-row', () => ({
  FileResultRow: ({ file }: { file: { id: string } }) => <button>{file.id}</button>,
}));

import { GlobalSearchModal } from '../global-search-modal';

beforeEach(() => {
  cleanup();
  close.mockClear();
  isOpen = true;
  searchResult = { messages: [], contacts: [], files: [], isLoading: false, isError: false };
});

describe('GlobalSearchModal', () => {
  it('renders nothing when closed', () => {
    isOpen = false;
    const { container } = render(<GlobalSearchModal onSwitchPanel={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('global-search-modal')).toBeNull();
  });

  it('shows the start-typing hint with an empty query', () => {
    render(<GlobalSearchModal onSwitchPanel={vi.fn()} />);
    expect(screen.getByText('startTyping')).toBeTruthy();
  });

  it('shows the loading state while a query is in flight', () => {
    searchResult = { ...searchResult, isLoading: true };
    render(<GlobalSearchModal onSwitchPanel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('global-search-input'), { target: { value: 'hi' } });
    expect(screen.getByText('loading')).toBeTruthy();
  });

  it('shows the error state on a failed search', () => {
    searchResult = { ...searchResult, isError: true };
    render(<GlobalSearchModal onSwitchPanel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('global-search-input'), { target: { value: 'hi' } });
    expect(screen.getByText('errorOccurred')).toBeTruthy();
  });

  it('shows the no-results state when a query returns nothing', () => {
    render(<GlobalSearchModal onSwitchPanel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('global-search-input'), { target: { value: 'zzz' } });
    expect(screen.getByText('noResults')).toBeTruthy();
  });

  it('renders the message + contact + file sections when there are hits', () => {
    searchResult = {
      messages: [{ id: 'm1' }],
      contacts: [{ id: 'c1' }],
      files: [{ id: 'f1' }],
      isLoading: false,
      isError: false,
    };
    render(<GlobalSearchModal onSwitchPanel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('global-search-input'), { target: { value: 'hi' } });
    expect(screen.getByTestId('section-messages')).toBeTruthy();
    expect(screen.getByTestId('section-contacts')).toBeTruthy();
    expect(screen.getByTestId('section-files')).toBeTruthy();
  });
});
