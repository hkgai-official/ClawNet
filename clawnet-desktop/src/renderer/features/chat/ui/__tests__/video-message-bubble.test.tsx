// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { VideoMessageBubble } from '../video-message-bubble';

const uploadEntry: Record<string, unknown> = {};

vi.mock('../../state/upload-slice', () => ({
  useUploadStore: (selector: (s: { uploads: typeof uploadEntry }) => unknown) =>
    selector({ uploads: uploadEntry }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

function msg(over: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    conversationId: 'c',
    sender: { id: 'u', type: 'human', name: 'me' },
    contentType: 'video',
    timestamp: '2026-05-25T00:00:00',
    content: { id: 'file-v1', name: 'clip.mp4' },
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  for (const k of Object.keys(uploadEntry)) delete uploadEntry[k];
});

describe('VideoMessageBubble', () => {
  it('uses clawnet-file://{id} as video src for sent messages', () => {
    render(<VideoMessageBubble message={msg() as never} />);
    fireEvent.click(screen.getByTestId('video-bubble'));
    const video = screen.getByTestId('video-player-modal').querySelector('video') as HTMLVideoElement;
    expect(video.src).toBe('clawnet-file://file-v1');
  });

  it('uses file://{localPath} as video src for optimistic in-flight messages', () => {
    const m = msg({ content: { localPath: '/tmp/clip.mp4', name: 'clip.mp4' } });
    render(<VideoMessageBubble message={m as never} />);
    fireEvent.click(screen.getByTestId('video-bubble'));
    const video = screen.getByTestId('video-player-modal').querySelector('video') as HTMLVideoElement;
    expect(video.src).toBe('file:///tmp/clip.mp4');
  });

  it('falls back to content.url when neither id nor localPath is set', () => {
    const m = msg({ content: { url: 'https://example.test/clip.mp4', name: 'clip.mp4' } });
    render(<VideoMessageBubble message={m as never} />);
    fireEvent.click(screen.getByTestId('video-bubble'));
    const video = screen.getByTestId('video-player-modal').querySelector('video') as HTMLVideoElement;
    expect(video.src).toBe('https://example.test/clip.mp4');
  });

  it('disables the play button when no source is available', () => {
    const m = msg({ content: { name: 'clip.mp4' } });
    render(<VideoMessageBubble message={m as never} />);
    const btn = screen.getByTestId('video-bubble') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('disables the play button while uploading even if src would resolve', () => {
    uploadEntry['m-1'] = { bytesSent: 200, totalBytes: 1000, status: 'in_progress' };
    render(<VideoMessageBubble message={msg() as never} />);
    const btn = screen.getByTestId('video-bubble') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
