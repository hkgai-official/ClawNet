// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

const mutateAsync = vi.fn();
let me: { displayName: string; userCode?: string; email?: string } | undefined;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../hooks/use-profile', () => ({
  useProfile: () => ({ data: me, isLoading: false }),
  useUpdateProfile: () => ({ mutateAsync, isPending: false }),
}));

vi.mock('../change-password-sheet', () => ({
  ChangePasswordSheet: () => <div data-testid="change-password-sheet" />,
}));

import { ProfileSettingsPanel } from '../profile-settings-panel';

beforeEach(() => {
  cleanup();
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue(undefined);
  me = { displayName: 'Alice', userCode: 'C1', email: 'z@x.test' };
});

describe('ProfileSettingsPanel', () => {
  it('initializes the name field + read-only rows from the profile', () => {
    render(<ProfileSettingsPanel />);
    expect(screen.getByDisplayValue('Alice')).toBeTruthy();
    expect(screen.getByText('C1')).toBeTruthy();
    expect(screen.getByText('z@x.test')).toBeTruthy();
  });

  it('Save is disabled until the name actually changes', () => {
    render(<ProfileSettingsPanel />);
    const save = screen.getByRole('button', { name: 'saveChanges' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByDisplayValue('Alice'), { target: { value: 'Newname' } });
    expect(save.disabled).toBe(false);
  });

  it('Save is disabled when the name is cleared', () => {
    render(<ProfileSettingsPanel />);
    fireEvent.change(screen.getByDisplayValue('Alice'), { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'saveChanges' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Save calls updateProfile with the trimmed name + shows success', async () => {
    render(<ProfileSettingsPanel />);
    fireEvent.change(screen.getByDisplayValue('Alice'), { target: { value: ' Renamed ' } });
    fireEvent.click(screen.getByRole('button', { name: 'saveChanges' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ displayName: 'Renamed' }));
    await waitFor(() => expect(screen.getByText('saved')).toBeTruthy());
  });

  it('Save failure shows an error message', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('name taken'));
    render(<ProfileSettingsPanel />);
    fireEvent.change(screen.getByDisplayValue('Alice'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'saveChanges' }));
    await waitFor(() => expect(screen.getByText('name taken')).toBeTruthy());
  });

  it('Change Password opens the sheet', () => {
    render(<ProfileSettingsPanel />);
    expect(screen.queryByTestId('change-password-sheet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'changePassword' }));
    expect(screen.getByTestId('change-password-sheet')).toBeTruthy();
  });
});
