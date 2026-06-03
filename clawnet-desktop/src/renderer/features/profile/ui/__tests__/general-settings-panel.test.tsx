// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GeneralSettingsPanel } from '../general-settings-panel';

const setLanguage = vi.fn();
const check = vi.fn();
const restart = vi.fn();
let updateStatus: { state: string; version?: string } = { state: 'idle' };

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts && 'defaultValue' in opts ? (opts.defaultValue as string) : k,
  }),
}));

vi.mock('../../../../hooks/use-i18n', () => ({
  useLanguage: () => ({ language: 'en', setLanguage }),
}));

vi.mock('../../../update/hooks/use-update-status', () => ({
  useUpdateStatus: () => ({ status: updateStatus, check, restart }),
}));

vi.mock('../../../../hooks/use-ipc', () => ({
  useIpc: () => vi.fn().mockResolvedValue({ version: '0.18.0' }),
}));

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GeneralSettingsPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  setLanguage.mockClear();
  check.mockClear();
  restart.mockClear();
  updateStatus = { state: 'idle' };
});

describe('GeneralSettingsPanel', () => {
  it('changing the language calls setLanguage', () => {
    renderPanel();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zh-Hans' } });
    expect(setLanguage).toHaveBeenCalledWith('zh-Hans');
  });

  it('shows the app version from the about query', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('0.18.0')).toBeTruthy());
  });

  it('idle update state → "Check for updates" button', () => {
    updateStatus = { state: 'idle' };
    renderPanel();
    expect(screen.getByRole('button', { name: 'update:checkForUpdates' })).toBeTruthy();
  });

  it('checking state disables the check button', () => {
    updateStatus = { state: 'checking' };
    renderPanel();
    expect((screen.getByRole('button', { name: 'update:checkForUpdates' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('downloaded state → Restart button that calls restart', () => {
    updateStatus = { state: 'downloaded', version: '0.19.0' };
    renderPanel();
    const btn = screen.getByRole('button', { name: 'update:restart' });
    fireEvent.click(btn);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('check button triggers the update check', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'update:checkForUpdates' }));
    expect(check).toHaveBeenCalledTimes(1);
  });
});
