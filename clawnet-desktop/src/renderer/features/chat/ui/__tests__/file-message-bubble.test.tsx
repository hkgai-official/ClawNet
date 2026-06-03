// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { FileMessageBubble } from '../file-message-bubble';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const ipcMock = vi.fn();
vi.mock('../../../../hooks/use-ipc', () => ({ useIpc: () => ipcMock }));

vi.mock('../../../../components/toast-overlay', () => ({
  toastStore: { getState: () => ({ push: vi.fn() }) },
}));

const uploadMutate = vi.fn();
vi.mock('../../hooks/use-file-upload', () => ({
  useFileUpload: () => ({ mutate: uploadMutate, mutateAsync: uploadMutate }),
}));

const downloadMutateAsync = vi.fn();
vi.mock('../../hooks/use-file-download', () => ({
  useFileDownloadMutation: () => ({ mutate: vi.fn(), mutateAsync: downloadMutateAsync }),
}));

const uploadEntry: Record<string, unknown> = {};
const startUpload = vi.fn();
vi.mock('../../state/upload-slice', () => ({
  useUploadStore: Object.assign(
    (sel: (s: { uploads: typeof uploadEntry; startUpload: typeof startUpload }) => unknown) =>
      sel({ uploads: uploadEntry, startUpload }),
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

const downloadEntry: Record<string, unknown> = {};
vi.mock('../../state/download-slice', () => ({
  useDownloadStore: Object.assign(
    (sel: (s: { downloads: typeof downloadEntry }) => unknown) => sel({ downloads: downloadEntry }),
    { getState: () => ({ downloads: downloadEntry }) },
  ),
}));

function msg(over: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    conversationId: 'c',
    sender: { id: 'u', type: 'human', name: 'me' },
    contentType: 'file',
    timestamp: '2026-05-24T00:00:00',
    content: { id: 'file-1', name: 'doc.pdf', size: 5000 },
    status: 'sent',
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  ipcMock.mockReset();
  uploadMutate.mockReset();
  startUpload.mockReset();
  downloadMutateAsync.mockReset();
  for (const k of Object.keys(uploadEntry)) delete uploadEntry[k];
  for (const k of Object.keys(downloadEntry)) delete downloadEntry[k];
});

describe('FileMessageBubble', () => {
  it('shows ring progress overlay during upload (status=in_progress)', () => {
    uploadEntry['m-1'] = { bytesSent: 1000, totalBytes: 5000, status: 'in_progress' };
    render(
      <FileMessageBubble
        message={msg({ status: 'sending' }) as never}
        isOwn
        conversationId="c"
      />,
    );
    expect(screen.getByTestId('upload-progress')).toBeTruthy();
  });

  it('shows Retry on upload failure and re-fires upload mutation on click', async () => {
    uploadEntry['m-1'] = { bytesSent: 0, totalBytes: 5000, status: 'failed', reason: 'net' };
    render(
      <FileMessageBubble
        message={msg({
          status: 'failed',
          content: { localPath: '/tmp/doc.pdf', name: 'doc.pdf', size: 5000 },
        }) as never}
        isOwn
        conversationId="c"
      />,
    );
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(uploadMutate).toHaveBeenCalledWith({ tempId: 'm-1', input: '/tmp/doc.pdf' }),
    );
    expect(startUpload).toHaveBeenCalledWith('m-1', 5000);
  });

  it('clicking Open triggers chat.fetchFileForOpen then shell.openPath', async () => {
    downloadMutateAsync.mockResolvedValueOnce({ localPath: '/cache/m-1_doc.pdf' });
    ipcMock.mockResolvedValueOnce({ ok: true });
    render(
      <FileMessageBubble message={msg() as never} isOwn={false} conversationId="c" />,
    );
    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    await waitFor(() =>
      expect(downloadMutateAsync).toHaveBeenCalledWith({ messageId: 'm-1', fileId: 'file-1' }),
    );
    await waitFor(() =>
      expect(ipcMock).toHaveBeenCalledWith('shell.openPath', { path: '/cache/m-1_doc.pdf' }),
    );
  });

  it('does NOT show Open button for own (sent) settled messages', () => {
    render(
      <FileMessageBubble message={msg() as never} isOwn={true} conversationId="c" />,
    );
    expect(screen.queryByRole('button', { name: /open/i })).toBeNull();
  });
});
