// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateTagSheet } from '../create-tag-sheet';

const mutateAsync = vi.fn();
let whitelist: string[] = [];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../hooks/use-tags', () => ({
  useCreateTag: () => ({ mutateAsync, isPending: false }),
}));

vi.mock('../../../settings/hooks/use-file-access', () => ({
  useFileAccess: () => ({ data: { allowedPaths: whitelist } }),
}));

vi.mock('../../../../components/ui/sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../denied-paths-editor', () => ({
  DeniedPathsEditor: () => <div data-testid="denied-paths-editor" />,
}));

beforeEach(() => {
  cleanup();
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue(undefined);
  whitelist = [];
});

describe('CreateTagSheet', () => {
  it('Create is disabled until a tag name is entered', () => {
    render(<CreateTagSheet onClose={vi.fn()} />);
    const create = screen.getByRole('button', { name: 'create' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Friends' } });
    expect(create.disabled).toBe(false);
  });

  it('shows the whitelist hint when no global allowed paths exist', () => {
    whitelist = [];
    render(<CreateTagSheet onClose={vi.fn()} />);
    expect(screen.getByText('addWhitelistFirst')).toBeTruthy();
  });

  it('submits displayName + nodeAcl built from the selected whitelist paths', async () => {
    whitelist = ['/work/a', '/work/b'];
    const onClose = vi.fn();
    render(<CreateTagSheet onClose={onClose} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' Friends ' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /\/work\/a/ }));
    fireEvent.click(screen.getByRole('button', { name: 'create' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0]![0]).toEqual({
      displayName: 'Friends',
      nodeAcl: { allowedPaths: ['/work/a'], deniedPaths: [] },
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('omits nodeAcl when nothing is selected', async () => {
    whitelist = ['/work/a'];
    render(<CreateTagSheet onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Bare' } });
    fireEvent.click(screen.getByRole('button', { name: 'create' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0]![0]).toEqual({ displayName: 'Bare', nodeAcl: undefined });
  });

  it('surfaces a server error message', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('name taken'));
    render(<CreateTagSheet onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'create' }));
    await waitFor(() => expect(screen.getByText('name taken')).toBeTruthy());
  });
});
