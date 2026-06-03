// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { DropZone } from '../drop-zone';
import { usePendingUploadsStore } from '../../state/pending-uploads-slice';

const toastPush = vi.fn();
vi.mock('../../../../components/toast-overlay', () => ({
  toastStore: { getState: () => ({ push: toastPush }) },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts && 'count' in opts) return `${k}:${opts['count'] as number}`;
      return k;
    },
  }),
}));

beforeEach(() => {
  cleanup();
  toastPush.mockClear();
  usePendingUploadsStore.setState({ byConversation: {} });
  // Default: window.clawnet.getPathForFile resolves '' (no native path).
  (window as unknown as { clawnet?: unknown }).clawnet = {
    getPathForFile: vi.fn((_f: File) => ''),
  };
});

function makeFile(name: string): File {
  return new File(['hello'], name, { type: 'text/plain' });
}

function dispatchDrop(target: HTMLElement, files: File[]) {
  fireEvent.drop(target, { dataTransfer: { files } });
}

describe('DropZone', () => {
  it('does not show overlay until dragover fires', () => {
    render(
      <DropZone conversationId="c1">
        <div data-testid="child" />
      </DropZone>,
    );
    expect(screen.queryByText('dropHere')).toBeNull();
  });

  it('shows the drop-here overlay on dragover', () => {
    render(
      <DropZone conversationId="c1">
        <div />
      </DropZone>,
    );
    const zone = screen.getByTestId('drop-zone');
    fireEvent.dragOver(zone);
    expect(screen.getByText('dropHere')).toBeTruthy();
  });

  it('hides overlay on dragleave', () => {
    render(
      <DropZone conversationId="c1">
        <div />
      </DropZone>,
    );
    const zone = screen.getByTestId('drop-zone');
    fireEvent.dragOver(zone);
    fireEvent.dragLeave(zone);
    expect(screen.queryByText('dropHere')).toBeNull();
  });

  it('pushes native files (resolved path) into pending-uploads', () => {
    const file = makeFile('a.txt');
    (window as unknown as { clawnet: { getPathForFile: (f: File) => string } }).clawnet.getPathForFile = vi.fn(
      () => '/tmp/a.txt',
    );
    render(
      <DropZone conversationId="cN">
        <div />
      </DropZone>,
    );
    dispatchDrop(screen.getByTestId('drop-zone'), [file]);
    const queue = usePendingUploadsStore.getState().byConversation['cN'] ?? [];
    expect(queue.length).toBe(1);
    expect(queue[0]).toMatchObject({ kind: 'path', path: '/tmp/a.txt', name: 'a.txt' });
  });

  it('warns via toast when a file has no resolvable path (browser blob)', () => {
    render(
      <DropZone conversationId="c1">
        <div />
      </DropZone>,
    );
    dispatchDrop(screen.getByTestId('drop-zone'), [makeFile('blob.png')]);
    expect(toastPush).toHaveBeenCalled();
    const arg = toastPush.mock.calls[0]![0] as { level: string; message: string };
    expect(arg.level).toBe('warning');
    expect(arg.message).toContain('dropRejected');
    expect(arg.message).toContain('1');
  });

  it('mixes accepted + rejected: only rejected count goes to toast', () => {
    const resolve = vi.fn().mockImplementation((f: File) =>
      f.name === 'ok.txt' ? '/tmp/ok.txt' : '',
    );
    (window as unknown as { clawnet: { getPathForFile: (f: File) => string } }).clawnet.getPathForFile =
      resolve;
    render(
      <DropZone conversationId="cM">
        <div />
      </DropZone>,
    );
    dispatchDrop(screen.getByTestId('drop-zone'), [makeFile('ok.txt'), makeFile('bad')]);
    expect(usePendingUploadsStore.getState().byConversation['cM']?.length).toBe(1);
    expect(toastPush).toHaveBeenCalledTimes(1);
    const arg = toastPush.mock.calls[0]![0] as { message: string };
    expect(arg.message).toContain('1');
  });

  it('drop with zero files is a no-op (no toast, no queue change)', () => {
    render(
      <DropZone conversationId="c1">
        <div />
      </DropZone>,
    );
    dispatchDrop(screen.getByTestId('drop-zone'), []);
    expect(toastPush).not.toHaveBeenCalled();
    expect(usePendingUploadsStore.getState().byConversation['c1']).toBeUndefined();
  });
});
