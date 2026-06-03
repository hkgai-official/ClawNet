// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditTagSheet } from '../edit-tag-sheet';
import type { Tag } from '../../../../../shared/domain/tag';

const mutateAsync = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../hooks/use-tags', () => ({
  useUpdateTag: () => ({ mutateAsync, isPending: false }),
}));

vi.mock('../../../settings/hooks/use-file-access', () => ({
  useFileAccess: () => ({ data: { allowedPaths: ['/work/a'] } }),
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

function makeTag(over: Partial<Tag> = {}): Tag {
  return {
    id: 'tag-1',
    ownerId: 'u1',
    name: 'friends',
    displayName: 'Friends',
    isDefault: false,
    workspaceId: 'w1',
    nodeAcl: { allowedPaths: ['/work/a'], deniedPaths: [] },
    createdAt: '2026-05-15T00:00:00Z',
    updatedAt: '2026-05-15T00:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue(undefined);
});

describe('EditTagSheet', () => {
  it('prefills the display name from the tag', () => {
    render(<EditTagSheet tag={makeTag()} onClose={vi.fn()} />);
    expect(screen.getByDisplayValue('Friends')).toBeTruthy();
  });

  it('non-main tag: PATCH includes nodeAcl', async () => {
    render(<EditTagSheet tag={makeTag()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const body = mutateAsync.mock.calls[0]![0] as { id: string; nodeAcl?: unknown };
    expect(body.id).toBe('tag-1');
    expect(body.nodeAcl).toEqual({ allowedPaths: ['/work/a'], deniedPaths: [] });
  });

  it('main tag: nodeAcl is omitted (server owns it) + no allowed-paths editor', async () => {
    render(<EditTagSheet tag={makeTag({ isMain: true })} onClose={vi.fn()} />);
    expect(screen.getByText('mainTagNodeAclNote')).toBeTruthy();
    expect(screen.queryByText('allowedPaths')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const body = mutateAsync.mock.calls[0]![0] as { nodeAcl?: unknown };
    expect(body.nodeAcl).toBeUndefined();
  });

  it('Save is disabled when the name is cleared', () => {
    render(<EditTagSheet tag={makeTag()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('Friends'), { target: { value: '  ' } });
    expect((screen.getByRole('button', { name: 'save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
