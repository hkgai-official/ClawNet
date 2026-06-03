// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChangePasswordSheet } from '../change-password-sheet';

const ipcMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../../hooks/use-ipc', () => ({
  useIpc: () => ipcMock,
}));

vi.mock('../../../../components/ui/sheet', () => ({
  // Strip the portal — render children inline so testing-library can find
  // them. The sheet's a11y is covered by its own spec; here we only care
  // about the form logic.
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function renderSheet(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={qc}>
        <ChangePasswordSheet onClose={onClose} />
      </QueryClientProvider>,
    ),
    onClose,
  };
}

function fields() {
  const inputs = screen.getAllByPlaceholderText(/Password|password/) as HTMLInputElement[];
  return { old: inputs[0]!, neu: inputs[1]!, conf: inputs[2]! };
}

beforeEach(() => {
  cleanup();
  ipcMock.mockReset();
});

describe('ChangePasswordSheet — submit gating', () => {
  it('disables Confirm when fields are empty', () => {
    renderSheet();
    const btn = screen.getByRole('button', { name: /confirmChanges/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('disables Confirm when new password is shorter than 6 chars', () => {
    renderSheet();
    const { old, neu, conf } = fields();
    fireEvent.change(old, { target: { value: 'a' } });
    fireEvent.change(neu, { target: { value: '12345' } });
    fireEvent.change(conf, { target: { value: '12345' } });
    const btn = screen.getByRole('button', { name: /confirmChanges/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('enables Confirm when old + new(≥6) + confirm all filled', () => {
    renderSheet();
    const { old, neu, conf } = fields();
    fireEvent.change(old, { target: { value: 'oldpw' } });
    fireEvent.change(neu, { target: { value: 'newpw123' } });
    fireEvent.change(conf, { target: { value: 'newpw123' } });
    const btn = screen.getByRole('button', { name: /confirmChanges/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

describe('ChangePasswordSheet — client-side validation order', () => {
  it('rejects when new !== confirm', async () => {
    renderSheet();
    const { old, neu, conf } = fields();
    fireEvent.change(old, { target: { value: 'oldpw' } });
    fireEvent.change(neu, { target: { value: 'newpw123' } });
    fireEvent.change(conf, { target: { value: 'mismatch' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmChanges/i }));
    expect(screen.getByText('passwordMismatch')).toBeTruthy();
    expect(ipcMock).not.toHaveBeenCalled();
  });

  it('rejects when new === old (after mismatch passes)', async () => {
    renderSheet();
    const { old, neu, conf } = fields();
    fireEvent.change(old, { target: { value: 'sameone' } });
    fireEvent.change(neu, { target: { value: 'sameone' } });
    fireEvent.change(conf, { target: { value: 'sameone' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmChanges/i }));
    expect(screen.getByText('passwordSameAsOld')).toBeTruthy();
    expect(ipcMock).not.toHaveBeenCalled();
  });
});

describe('ChangePasswordSheet — happy path', () => {
  it('calls auth.changePassword IPC and shows success message', async () => {
    ipcMock.mockResolvedValueOnce(undefined);
    renderSheet();
    const { old, neu, conf } = fields();
    fireEvent.change(old, { target: { value: 'oldpw1' } });
    fireEvent.change(neu, { target: { value: 'newpw123' } });
    fireEvent.change(conf, { target: { value: 'newpw123' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmChanges/i }));
    await waitFor(() => {
      expect(ipcMock).toHaveBeenCalledWith('auth.changePassword', {
        oldPassword: 'oldpw1',
        newPassword: 'newpw123',
      });
    });
    await waitFor(() => {
      expect(screen.getByText('passwordChanged')).toBeTruthy();
    });
  });
});
