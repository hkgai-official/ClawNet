import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useGlobalSearchStore } from '../state/global-search-slice';
import { useDebouncedValue } from '../hooks/use-debounced-value';
import { useGlobalSearch } from '../hooks/use-global-search';
import { ResultSection } from './result-section';
import { MessageResultRow } from './message-result-row';
import { ContactResultRow } from './contact-result-row';
import { FileResultRow } from './file-result-row';

/**
 * Wraps a single result row so global-search-modal can track keyboard
 * selection via a flat index. `Enter` finds the wrapper by
 * `data-search-row-index` and synthesizes a click on it (and the bubble
 * delivers the click to the actual row button child).
 */
function RowSlot({
  index,
  selected,
  children,
}: {
  index: number;
  selected: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-search-row-index={index}
      aria-selected={selected}
      onClick={(e) => {
        // When user clicks anywhere in the slot, let the inner row receive
        // the click as well. The row buttons stopPropagation isn't a
        // concern here — both wrapper and child handle the same event.
        void e;
      }}
      style={{
        background: selected ? 'var(--color-bg-overlay)' : 'transparent',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
      }}
    >
      {children}
    </div>
  );
}

interface Props {
  /**
   * Switch the host App's visible panel — needed so contact/message hits
   * route the user to the right panel before the row's jump effect runs.
   * Mounted at App.tsx level where `setActivePanel` is in scope; this
   * avoids reaching into AppSidebar internals.
   */
  onSwitchPanel: (panel: 'contacts' | 'chat') => void;
}

/**
 * Cmd/Ctrl+F or the AppSidebar search icon opens this. Debounced 300ms,
 * fans out to chat.search.messages + contacts.search + files.search in
 * parallel via useGlobalSearch. Esc closes; click-outside closes.
 */
export function GlobalSearchModal({ onSwitchPanel }: Props) {
  const { t } = useTranslation('search');
  const isOpen = useGlobalSearchStore((s) => s.isOpen);
  const close = useGlobalSearchStore((s) => s.close);
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 300);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rowsRef = useRef<HTMLDivElement | null>(null);
  const results = useGlobalSearch(debounced);

  // Flat keyboard-nav index across all three result sections. Reset to 0
  // whenever the result set changes so the user always sees a selection
  // at the top.
  const [selectedIndex, setSelectedIndex] = useState(0);
  const totalCount = useMemo(
    () => results.messages.length + results.contacts.length + results.files.length,
    [results.messages.length, results.contacts.length, results.files.length],
  );
  useEffect(() => {
    setSelectedIndex(0);
  }, [debounced, totalCount]);

  // Auto-focus on open; clear query on close.
  useEffect(() => {
    if (isOpen) {
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
    setQuery('');
    return undefined;
  }, [isOpen]);

  // Keyboard navigation: ↑/↓ move selection, Enter activates, Esc closes.
  // We dispatch a synthetic click on the selected row's DOM node so each
  // row's existing onClick stays the single source of truth for its
  // jump behavior — no need to lift handlers up here.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (totalCount === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % totalCount);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + totalCount) % totalCount);
      } else if (e.key === 'Enter') {
        const root = rowsRef.current;
        if (!root) return;
        const slot = root.querySelector<HTMLElement>(
          `[data-search-row-index="${selectedIndex}"]`,
        );
        // Each result row renders a <button> child; click that so its
        // onClick (which performs the actual jump) fires.
        const btn = slot?.querySelector<HTMLButtonElement>('button');
        if (btn) {
          e.preventDefault();
          btn.click();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close, totalCount, selectedIndex]);

  // Scroll the selected row into view as selectedIndex changes.
  useEffect(() => {
    const root = rowsRef.current;
    if (!root) return;
    const node = root.querySelector<HTMLElement>(
      `[data-search-row-index="${selectedIndex}"]`,
    );
    node?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, totalCount]);

  if (!isOpen) return null;

  const hasQuery = debounced.trim().length > 0;
  const totalResults = totalCount;

  return createPortal(
    <div
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-scrim)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 80,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid="global-search-modal"
        role="dialog"
        aria-label={t('title')}
        style={{
          background: 'var(--color-bg-surface)',
          borderRadius: 'var(--radius-lg)',
          width: 560,
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 10px 40px var(--color-scrim)',
          border: '1px solid var(--color-border-subtle)',
        }}
      >
        <div
          style={{
            padding: 12,
            borderBottom: '1px solid var(--color-border-subtle)',
          }}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('placeholder')}
            data-testid="global-search-input"
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: 14,
              background: 'var(--color-bg-surface-2)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-primary)',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>

        <div ref={rowsRef} style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
          {!hasQuery && (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                color: 'var(--color-text-muted)',
                fontSize: 12,
              }}
            >
              {t('startTyping')}
            </div>
          )}
          {hasQuery && results.isLoading && (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                color: 'var(--color-text-secondary)',
                fontSize: 12,
              }}
            >
              {t('loading')}
            </div>
          )}
          {hasQuery && results.isError && (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                color: 'var(--color-danger)',
                fontSize: 12,
              }}
            >
              {t('errorOccurred')}
            </div>
          )}
          {hasQuery && !results.isLoading && !results.isError && totalResults === 0 && (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                color: 'var(--color-text-muted)',
                fontSize: 12,
              }}
            >
              {t('noResults', { query: debounced })}
            </div>
          )}

          <ResultSection label={t('messages')} count={results.messages.length}>
            {results.messages.map((m, i) => {
              const idx = i;
              return (
                <RowSlot key={m.id} index={idx} selected={selectedIndex === idx}>
                  <MessageResultRow
                    message={m}
                    query={debounced}
                    onSwitchPanel={onSwitchPanel}
                  />
                </RowSlot>
              );
            })}
          </ResultSection>

          <ResultSection label={t('contacts')} count={results.contacts.length}>
            {results.contacts.map((c, i) => {
              const idx = results.messages.length + i;
              return (
                <RowSlot key={c.id} index={idx} selected={selectedIndex === idx}>
                  <ContactResultRow contact={c} onSwitchPanel={onSwitchPanel} />
                </RowSlot>
              );
            })}
          </ResultSection>

          <ResultSection label={t('files')} count={results.files.length}>
            {results.files.map((f, i) => {
              const idx = results.messages.length + results.contacts.length + i;
              return (
                <RowSlot key={f.id} index={idx} selected={selectedIndex === idx}>
                  <FileResultRow file={f} />
                </RowSlot>
              );
            })}
          </ResultSection>
        </div>
      </div>
    </div>,
    document.body,
  );
}
