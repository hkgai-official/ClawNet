// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { LoginScreen } from '../login';

const loginMutate = vi.fn();
const ipcMock = vi.fn().mockResolvedValue('http://from-ipc:9999');

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
  }),
}));

vi.mock('../../hooks/use-auth', () => ({
  useAuth: () => ({
    login: { mutate: loginMutate, isPending: false },
  }),
}));

vi.mock('../../../../hooks/use-ipc', () => ({
  useIpc: () => ipcMock,
}));

vi.mock('lucide-react', () => ({
  MessagesSquare: () => null,
}));

beforeEach(() => {
  cleanup();
  loginMutate.mockClear();
  ipcMock.mockClear();
  ipcMock.mockResolvedValue('http://from-ipc:9999');
});

describe('LoginScreen — submit gating', () => {
  it('disables Sign In when username is empty', () => {
    render(<LoginScreen />);
    const btn = screen.getByRole('button', { name: /loginButton/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('disables Sign In when only username provided (no password)', () => {
    render(<LoginScreen />);
    const accountInput = screen.getByRole('textbox', { name: /loginAccount/i });
    fireEvent.change(accountInput, { target: { value: 'alice' } });
    const btn = screen.getByRole('button', { name: /loginButton/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('enables Sign In once username + password are both non-empty', () => {
    const { container } = render(<LoginScreen />);
    const accountInput = screen.getByRole('textbox', { name: /loginAccount/i });
    fireEvent.change(accountInput, { target: { value: 'alice' } });
    const pw = container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(pw, { target: { value: 'p' } });
    const btn = screen.getByRole('button', { name: /loginButton/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

describe('LoginScreen — form submission', () => {
  it('calls login.mutate with serverURL/username/password on submit', () => {
    const { container } = render(<LoginScreen />);
    // Server URL input is hidden (display:none) but still in the DOM; reach it
    // by type selector so state binding is exercised.
    const urlInput = container.querySelector('input[type="url"]') as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: 'http://srv' } });
    const accountInput = screen.getByRole('textbox', { name: /loginAccount/i });
    fireEvent.change(accountInput, { target: { value: 'user' } });
    const pw = container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(pw, { target: { value: 'pass' } });

    fireEvent.submit(container.querySelector('form')!);

    expect(loginMutate).toHaveBeenCalledTimes(1);
    const args = loginMutate.mock.calls[0]![0] as { serverURL: string; username: string; password: string };
    expect(args.serverURL).toBe('http://srv');
    expect(args.username).toBe('user');
    expect(args.password).toBe('pass');
  });
});

describe('LoginScreen — error display', () => {
  it('shows error message returned from login.mutate onError', async () => {
    loginMutate.mockImplementation((_vars: unknown, opts: { onError?: (e: Error) => void } | undefined) => {
      opts?.onError?.(new Error('bad creds'));
    });
    const { container } = render(<LoginScreen />);
    const accountInput = screen.getByRole('textbox', { name: /loginAccount/i });
    fireEvent.change(accountInput, { target: { value: 'u' } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: 'p' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(screen.getByRole('alert').textContent).toBe('bad creds');
  });
});

describe('LoginScreen — server URL visibility', () => {
  it('hides the Server URL field from the form', () => {
    const { container } = render(<LoginScreen />);
    const hiddenLabel = container.querySelector('label[aria-hidden="true"]') as HTMLElement | null;
    expect(hiddenLabel).not.toBeNull();
    expect(hiddenLabel!.style.display).toBe('none');
    // State binding still works — input is in DOM:
    const urlInput = container.querySelector('input[type="url"]');
    expect(urlInput).not.toBeNull();
  });
});
