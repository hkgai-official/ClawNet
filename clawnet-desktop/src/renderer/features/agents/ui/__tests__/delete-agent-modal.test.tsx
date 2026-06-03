// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { DeleteAgentModal } from '../delete-agent-modal';

const delMutate = vi.fn();
const toastPush = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts && 'name' in opts ? `${k}:${opts.name as string}` : k,
  }),
}));

vi.mock('../../hooks/use-agent-mutations', () => ({
  useDeleteAgent: () => ({ mutate: delMutate }),
}));

vi.mock('../../../../components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../../components/toast-overlay', () => ({
  toastStore: { getState: () => ({ push: toastPush }) },
}));

beforeEach(() => {
  cleanup();
  delMutate.mockClear();
  toastPush.mockClear();
});

describe('DeleteAgentModal', () => {
  it('confirm calls the delete mutation with the agent id', () => {
    render(<DeleteAgentModal agentId="a-1" agentName="Bot" onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'wizard.delete' }).at(-1)!);
    expect(delMutate.mock.calls[0]![0]).toBe('a-1');
  });

  it('onSuccess closes the modal', () => {
    const onClose = vi.fn();
    delMutate.mockImplementation((_id: string, opts: { onSuccess?: () => void }) => {
      opts.onSuccess?.();
    });
    render(<DeleteAgentModal agentId="a-1" agentName="Bot" onClose={onClose} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'wizard.delete' }).at(-1)!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('onError pushes an error toast', () => {
    delMutate.mockImplementation((_id: string, opts: { onError?: () => void }) => {
      opts.onError?.();
    });
    render(<DeleteAgentModal agentId="a-1" agentName="Bot" onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'wizard.delete' }).at(-1)!);
    expect(toastPush).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('cancel closes without deleting', () => {
    const onClose = vi.fn();
    render(<DeleteAgentModal agentId="a-1" agentName="Bot" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'wizard.cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(delMutate).not.toHaveBeenCalled();
  });

  it('confirm is a no-op when agentId is null', () => {
    // agentId null → Sheet closed (open=false), nothing renders.
    const { container } = render(
      <DeleteAgentModal agentId={null} agentName="Bot" onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
