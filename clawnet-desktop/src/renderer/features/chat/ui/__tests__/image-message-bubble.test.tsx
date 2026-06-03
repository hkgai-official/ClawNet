// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ImageMessageBubble } from '../image-message-bubble';

const uploadEntry: Record<string, unknown> = {};
const uploadMutate = vi.fn();
const startUpload = vi.fn();

vi.mock('../../state/upload-slice', () => ({
  useUploadStore: Object.assign(
    (selector: (s: { uploads: typeof uploadEntry }) => unknown) =>
      selector({ uploads: uploadEntry }),
    {
      getState: () => ({
        uploads: uploadEntry,
        startUpload,
        updateProgress: vi.fn(),
        completeUpload: vi.fn(),
        failUpload: vi.fn(),
        setTotalBytes: vi.fn(),
      }),
    },
  ),
}));
vi.mock('../../hooks/use-file-upload', () => ({
  useFileUpload: () => ({ mutate: uploadMutate }),
}));
const ipcMock = vi.fn();
vi.mock('../../../../hooks/use-ipc', () => ({ useIpc: () => ipcMock }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

function msg(over: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    conversationId: 'c',
    sender: { id: 'u', type: 'human', name: 'me' },
    contentType: 'image',
    timestamp: '2026-05-24T00:00:00',
    content: { id: 'file-1', name: 'pic.png' },
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  uploadMutate.mockReset();
  startUpload.mockReset();
  ipcMock.mockReset();
  for (const k of Object.keys(uploadEntry)) delete uploadEntry[k];
});

describe('ImageMessageBubble', () => {
  it('renders <img src="clawnet-file://{id}"> for sent messages', () => {
    const { container } = render(<ImageMessageBubble message={msg() as never} conversationId="c" />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe('clawnet-file://file-1');
  });

  it('renders <img src="file://{localPath}"> for optimistic in-flight messages', () => {
    const m = msg({ content: { localPath: '/tmp/pic.png', name: 'pic.png' } });
    const { container } = render(<ImageMessageBubble message={m as never} conversationId="c" />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe('file:///tmp/pic.png');
  });

  it('shows progress overlay when upload entry is in_progress', () => {
    uploadEntry['m-1'] = { bytesSent: 500, totalBytes: 1000, status: 'in_progress' };
    const { container } = render(<ImageMessageBubble message={msg() as never} conversationId="c" />);
    // Existing implementation renders a small overlay container (aria-hidden) which
    // contains the actual progress bar div with a width% style.
    const progressContainer = container.querySelector('[aria-hidden="true"]');
    expect(progressContainer).toBeTruthy();
    expect(progressContainer?.querySelector('[style*="width"]')).toBeTruthy();
  });

  it('shows failed-retry button when upload entry status is failed; click re-fires upload mutation with same tempId', () => {
    uploadEntry['m-1'] = { bytesSent: 0, totalBytes: 100, status: 'failed', reason: 'net' };
    const m = msg({ content: { id: null, localPath: '/tmp/pic.png', name: 'pic.png' } });
    render(<ImageMessageBubble message={m as never} conversationId="c" />);
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(uploadMutate).toHaveBeenCalledWith({ tempId: 'm-1', input: '/tmp/pic.png' });
    expect(startUpload).toHaveBeenCalledWith('m-1', expect.any(Number));
  });

  it('shows cancel button while uploading; click fires chat.cancelUpload IPC', () => {
    uploadEntry['m-1'] = { bytesSent: 200, totalBytes: 1000, status: 'in_progress' };
    render(<ImageMessageBubble message={msg() as never} conversationId="c" />);
    const cancel = screen.getByTestId('cancel-upload');
    fireEvent.click(cancel);
    expect(ipcMock).toHaveBeenCalledWith('chat.cancelUpload', { tempId: 'm-1' });
  });
});
