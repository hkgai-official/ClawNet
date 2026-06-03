// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Composer } from '../composer';
import { useUploadStore } from '../../state/upload-slice';
import type { PendingUpload } from '../../state/pending-uploads-slice';

const sendMutate = vi.fn();
// Stable reference so tests can inspect calls.
const uploadMutate = vi.fn();
// Stable IPC mock shared across all tests.
const ipcMock = vi.fn();

// Mutable pending items that tests can pre-populate.
let mockPendingItems: PendingUpload[] = [];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? k,
  }),
}));

vi.mock('../../hooks/use-send-message', () => ({
  useSendMessage: () => ({ mutate: sendMutate, isPending: false }),
}));

vi.mock('../../hooks/use-file-upload', () => ({
  useFileUpload: () => ({ mutate: uploadMutate, mutateAsync: uploadMutate, isPending: false }),
}));

vi.mock('../../state/pending-uploads-slice', () => ({
  // Slice exposes `byConversation` + actions named `add` / `remove` /
  // `clear` (NOT `pendingByConv` / `addPending` / etc.). composer.tsx
  // pulls them via four separate selectors at lines 47-52.
  usePendingUploadsStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      byConversation: { 'conv-1': mockPendingItems },
      add: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../../../hooks/use-ipc', () => ({
  useIpc: () => ipcMock,
}));

vi.mock('../../../../components/toast-overlay', () => ({
  toastStore: { getState: () => ({ push: vi.fn() }) },
}));

beforeEach(() => {
  cleanup();
  sendMutate.mockClear();
  uploadMutate.mockClear();
  ipcMock.mockClear();
  mockPendingItems = [];
  // Reset upload store so each test starts fresh.
  useUploadStore.setState({ uploads: {} });
});

function renderComposer() {
  render(<Composer conversationId="conv-1" />);
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
  return { textarea };
}

describe('Composer IME guard', () => {
  it('does NOT submit when Enter is pressed while IME composing', () => {
    const { textarea } = renderComposer();
    fireEvent.change(textarea, { target: { value: 'ni' } });
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });
    expect(sendMutate).not.toHaveBeenCalled();
  });

  it('DOES submit when Enter is pressed and not composing', () => {
    const { textarea } = renderComposer();
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: false });
    expect(sendMutate).toHaveBeenCalledTimes(1);
  });
});

describe('Composer paste normalization', () => {
  beforeEach(() => vi.clearAllMocks());

  function pasteText(textarea: HTMLTextAreaElement, text: string) {
    // jsdom doesn't polyfill DataTransfer; pass a minimal duck-typed object
    // that mirrors what composer.tsx reads:
    //   - `items` (Array-like) for the image branch
    //   - `getData('text/plain')` for the plain-text branch
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [],
        getData: (type: string) => (type === 'text/plain' ? text : ''),
      },
    });
  }

  it('collapses 3+ blank lines to 2 on paste', () => {
    renderComposer();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    pasteText(textarea, 'a\n\n\nb');
    expect(textarea.value).toBe('a\n\nb');
  });

  it('converts CRLF and CR to LF on paste', () => {
    renderComposer();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    pasteText(textarea, 'a\r\nb\rc');
    expect(textarea.value).toBe('a\nb\nc');
  });

  it('preserves leading/trailing whitespace (no full-string trim)', () => {
    renderComposer();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    pasteText(textarea, '  hello  ');
    expect(textarea.value).toBe('  hello  ');
  });

  it('image item on clipboard wins; plain text is not inserted', () => {
    renderComposer();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'p.png', { type: 'image/png' });
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          { kind: 'file', type: 'image/png', getAsFile: () => file },
        ],
        getData: (type: string) => (type === 'text/plain' ? 'should be ignored' : ''),
      },
    });
    // The image branch runs first, calls e.preventDefault() and returns
    // before the plain-text branch can run — so the textarea stays empty.
    expect(textarea.value).toBe('');
  });
});

describe('Composer auto-grow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('initial textarea has rows="1" and minHeight 36', () => {
    renderComposer();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.rows).toBe(1);
    expect(textarea.style.minHeight).toBe('36px');
    expect(textarea.style.maxHeight).toBe('200px');
  });

  it('autoGrow runs on input change (style.height updated)', () => {
    renderComposer();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'line1\nline2\nline3' } });
    // jsdom does not compute layout — scrollHeight is 0. We can only
    // assert that the inline height was assigned (not 'auto').
    expect(textarea.style.height).not.toBe('');
    expect(textarea.style.height).not.toBe('auto');
  });

  it('autoGrow runs after emoji insert', () => {
    renderComposer();
    const emojiBtn = screen.getByLabelText(/Insert emoji/i);
    fireEvent.click(emojiBtn);
    const firstEmoji = screen.getAllByRole('button').find((b) =>
      ['😀','😁','😂','😍','😎','👍'].some((e) => b.textContent === e),
    );
    if (firstEmoji) fireEvent.click(firstEmoji);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.style.height).not.toBe('');
  });

  it('autoGrow runs after paste', () => {
    renderComposer();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [],
        getData: (t: string) => (t === 'text/plain' ? 'pasted\nlines\nhere' : ''),
      },
    });
    expect(textarea.style.height).not.toBe('');
  });

  it('snaps textarea height back to 36px when text is cleared', () => {
    renderComposer();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    // Type something so autoGrow runs and assigns some height.
    fireEvent.change(textarea, { target: { value: 'line1\nline2\nline3' } });
    // The previous onChange test asserts style.height !== '' here.
    // Now clear the text — the useEffect on `text === ''` should snap
    // the height back to '36px'.
    fireEvent.change(textarea, { target: { value: '' } });
    expect(textarea.style.height).toBe('36px');
  });
});

describe('Composer file send with tempId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('on file send: generates a tempId, calls startUpload(tempId, size), fires upload mutation with tempId', async () => {
    // Pre-populate a pending file (path branch) so submit triggers an upload.
    mockPendingItems = [
      { id: 'p-1', kind: 'path', name: 'pic.png', path: '/tmp/pic.png' },
    ];

    render(<Composer conversationId="conv-1" />);

    // Verify the attach button has the expected testid (used by Task 8 e2e).
    expect(screen.getByTestId('attach-file-btn')).toBeTruthy();

    // Submit the form to trigger the actual upload mutation.
    const form = document.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(uploadMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          tempId: expect.any(String),
          input: '/tmp/pic.png',
        }),
        expect.anything(),
      );
    });

    // Also verify startUpload was called with the same tempId and size=0 (path branch).
    const calledTempId = (uploadMutate.mock.calls[0]?.[0] as { tempId: string }).tempId;
    expect(useUploadStore.getState().uploads[calledTempId]).toBeDefined();
    expect(useUploadStore.getState().uploads[calledTempId]?.totalBytes).toBe(0);
  });
});
