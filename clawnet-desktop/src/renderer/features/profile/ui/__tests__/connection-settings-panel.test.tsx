// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

const ipcMock = vi.fn();
const manualReconnect = vi.fn();
const updateServerURL = vi.fn();
const toastPush = vi.fn();
let status = 'connected';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts && 'defaultValue' in opts ? (opts.defaultValue as string) : k,
  }),
}));

vi.mock('../../../../hooks/use-ipc', () => ({
  useIpc: () => ipcMock,
}));

vi.mock('../../../../hooks/use-connection', () => ({
  useConnection: () => ({ status, manualReconnect }),
}));

vi.mock('../../../auth/hooks/use-auth', () => ({
  useAuth: () => ({ updateServerURL }),
}));

vi.mock('../../../../components/toast-overlay', () => ({
  toastStore: { getState: () => ({ push: toastPush }) },
}));

import { ConnectionSettingsPanel } from '../connection-settings-panel';

beforeEach(() => {
  cleanup();
  ipcMock.mockReset();
  ipcMock.mockResolvedValue('http://srv:9010');
  manualReconnect.mockReset();
  manualReconnect.mockResolvedValue(undefined);
  updateServerURL.mockReset();
  updateServerURL.mockResolvedValue(undefined);
  toastPush.mockClear();
  status = 'connected';
});

describe('ConnectionSettingsPanel', () => {
  it('loads and prefills the current server URL', async () => {
    render(<ConnectionSettingsPanel />);
    await waitFor(() => expect(screen.getByDisplayValue('http://srv:9010')).toBeTruthy());
  });

  it('Apply is disabled until the URL changes', async () => {
    render(<ConnectionSettingsPanel />);
    await waitFor(() => screen.getByDisplayValue('http://srv:9010'));
    const apply = screen.getByRole('button', { name: 'Apply & Reconnect' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'http://other:9010' },
    });
    expect(apply.disabled).toBe(false);
  });

  it('rejects a URL without an http(s) scheme', async () => {
    render(<ConnectionSettingsPanel />);
    await waitFor(() => screen.getByDisplayValue('http://srv:9010'));
    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'ftp://bad' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply & Reconnect' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(updateServerURL).not.toHaveBeenCalled();
  });

  it('Apply with a valid URL updates the server URL and reconnects', async () => {
    render(<ConnectionSettingsPanel />);
    await waitFor(() => screen.getByDisplayValue('http://srv:9010'));
    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'https://new:9010' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply & Reconnect' }));
    await waitFor(() => expect(updateServerURL).toHaveBeenCalledWith('https://new:9010'));
    await waitFor(() => expect(manualReconnect).toHaveBeenCalled());
  });

  it('Reconnect now is disabled while connecting/reconnecting', async () => {
    status = 'reconnecting';
    render(<ConnectionSettingsPanel />);
    await waitFor(() => screen.getByDisplayValue('http://srv:9010'));
    expect((screen.getByRole('button', { name: 'Reconnect now' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
