// @vitest-environment jsdom
// src/renderer/features/chat/ui/__tests__/status-bar.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StatusBar } from '../status-bar';
import { useStreamingStore } from '../../state/streaming-slice';

// Mock useConnection so each test can drive it.
const connectionState = {
  status: 'connected' as 'connected' | 'connecting' | 'reconnecting' | 'disconnected',
  lastError: null as string | null,
  reconnectAttempt: 0,
  manualReconnect: vi.fn(async () => {}),
};

vi.mock('../../../../hooks/use-connection', () => ({
  useConnection: () => connectionState,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const ipcMock = vi.fn(async () => undefined);
vi.mock('../../../../hooks/use-ipc', () => ({
  useIpc: () => ipcMock,
}));

beforeEach(() => {
  cleanup();
  Object.assign(connectionState, {
    status: 'connected',
    lastError: null,
    reconnectAttempt: 0,
  });
  connectionState.manualReconnect.mockClear();
  useStreamingStore.setState({ byId: {} });
  ipcMock.mockClear();
});

describe('StatusBar visibility (StatusBarView.swift:11-17)', () => {
  it('renders nothing when connected and not streaming (zero-noise rule)', () => {
    const { container } = render(<StatusBar />);
    expect(container.firstChild).toBeNull();
  });

  it('renders when streaming even if connected', () => {
    useStreamingStore.getState().applyStart({
      messageId: 'm1',
      conversationId: 'c1',
      sender: { id: 'u1', name: 'X', type: 'human' },
    });
    render(<StatusBar />);
    expect(screen.getByText('generating')).toBeTruthy();
  });

  it('renders when disconnected', () => {
    Object.assign(connectionState, { status: 'disconnected' });
    render(<StatusBar />);
    expect(screen.getByText('disconnected')).toBeTruthy();
  });
});

describe('StatusBar error banner (StatusBarView.swift:20-41)', () => {
  it('shows "gatewayUnreachable" banner + retry button when disconnected with lastError', async () => {
    Object.assign(connectionState, { status: 'disconnected', lastError: 'connect: ECONNREFUSED' });
    render(<StatusBar />);
    expect(screen.getByText(/gatewayUnreachable/)).toBeTruthy();
    expect(screen.getByText(/ECONNREFUSED/)).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'retry' });
    retry.click();
    expect(connectionState.manualReconnect).toHaveBeenCalledTimes(1);
  });
});

describe('StatusBar reconnect button (StatusBarView.swift:52-59)', () => {
  it('shows Reconnect when disconnected + reconnectAttempt > 0 AND no lastError', async () => {
    Object.assign(connectionState, { status: 'disconnected', reconnectAttempt: 3, lastError: null });
    render(<StatusBar />);
    const reconnect = screen.getByRole('button', { name: 'reconnect' });
    reconnect.click();
    expect(connectionState.manualReconnect).toHaveBeenCalledTimes(1);
  });

  it('does NOT show Reconnect on initial-load disconnect (reconnectAttempt === 0)', () => {
    Object.assign(connectionState, { status: 'disconnected', reconnectAttempt: 0, lastError: null });
    render(<StatusBar />);
    expect(screen.queryByRole('button', { name: 'reconnect' })).toBeNull();
  });

  it('does NOT show Reconnect when there is a lastError (the error banner has its own Retry instead)', () => {
    Object.assign(connectionState, { status: 'disconnected', reconnectAttempt: 3, lastError: 'oops' });
    render(<StatusBar />);
    expect(screen.queryByRole('button', { name: 'reconnect' })).toBeNull();
  });
});

describe('StatusBar status label (StatusBarView.swift:90-97)', () => {
  it('shows "disconnectedLost" when needsManualReconnect (reconnectAttempt > 0) without lastError', () => {
    Object.assign(connectionState, { status: 'disconnected', reconnectAttempt: 2, lastError: null });
    render(<StatusBar />);
    expect(screen.getByText('disconnectedLost')).toBeTruthy();
  });
});

describe('StatusBar Stop button (M #B2)', () => {
  it('shows Stop while streaming', () => {
    useStreamingStore.getState().applyStart({
      messageId: 'm-abc',
      conversationId: 'c-abc',
      sender: { id: 'u1', name: 'X', type: 'human' },
    });
    render(<StatusBar />);
    expect(screen.getByRole('button', { name: 'stop' })).toBeTruthy();
  });

  it('does NOT show Stop while not streaming', () => {
    render(<StatusBar />);
    expect(screen.queryByRole('button', { name: 'stop' })).toBeNull();
  });

  it('clicking Stop fires chat.stream.cancel with BOTH messageId and conversationId', () => {
    // Regression for round-5 eval P0: macOS sends conversation_id.
    useStreamingStore.getState().applyStart({
      messageId: 'm-1',
      conversationId: 'c-1',
      sender: { id: 'u1', name: 'X', type: 'human' },
    });
    render(<StatusBar />);
    screen.getByRole('button', { name: 'stop' }).click();
    expect(ipcMock).toHaveBeenCalledWith('chat.stream.cancel', {
      messageId: 'm-1',
      conversationId: 'c-1',
    });
  });
});
