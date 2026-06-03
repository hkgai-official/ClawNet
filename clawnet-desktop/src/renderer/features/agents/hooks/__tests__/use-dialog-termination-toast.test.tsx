// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useDialogTerminationToast } from '../use-dialog-termination-toast';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, opts?: Record<string, unknown>) =>
      (opts?.defaultValue as string | undefined) ?? _k,
  }),
}));

const toastPush = vi.fn();
vi.mock('../../../../components/toast-overlay', () => ({
  toastStore: { getState: () => ({ push: toastPush }) },
}));

let ipcListeners: Record<string, (p: unknown) => void> = {};

beforeEach(() => {
  cleanup();
  toastPush.mockClear();
  ipcListeners = {};
  // Minimal `window.clawnet.on(name, listener) => unsub` stub. The hook
  // wires its callback via this; we capture it so tests can fire events.
  (globalThis as unknown as { window: Window }).window = (globalThis as unknown as { window: Window }).window ?? ({} as Window);
  (window as unknown as { clawnet: unknown }).clawnet = {
    on: (name: string, listener: (p: unknown) => void) => {
      ipcListeners[name] = listener;
      return () => { delete ipcListeners[name]; };
    },
  };
});

function Harness() {
  useDialogTerminationToast();
  return null;
}

describe('useDialogTerminationToast', () => {
  it('fires a warning toast when oldStatus=pending_approval → terminated (responder reject)', () => {
    render(<Harness />);
    const fire = ipcListeners['dialog.status.changed'];
    expect(fire).toBeDefined();
    fire!({
      sessionId: 's1',
      status: 'terminated',
      oldStatus: 'pending_approval',
      terminationReason: 'Owner rejected the dialog request',
    });
    expect(toastPush).toHaveBeenCalledTimes(1);
    const arg = toastPush.mock.calls[0]![0] as { level: string; message: string };
    expect(arg.level).toBe('warning');
    expect(arg.message).toMatch(/reject/i);
  });

  it('fires an info toast for active → terminated (user pressed Terminate)', () => {
    render(<Harness />);
    const fire = ipcListeners['dialog.status.changed']!;
    fire({
      sessionId: 's1',
      status: 'terminated',
      oldStatus: 'active',
      terminationReason: 'owner_terminated',
    });
    expect(toastPush).toHaveBeenCalledTimes(1);
    const arg = toastPush.mock.calls[0]![0] as { level: string };
    expect(arg.level).toBe('info');
  });

  it('treats a localized custom rejection reason structurally, not lexically', () => {
    // Before the structural discriminator we'd miss this because the
    // string doesn't contain "reject" — the new oldStatus check makes
    // the wire-text irrelevant.
    render(<Harness />);
    const fire = ipcListeners['dialog.status.changed']!;
    fire({
      sessionId: 's1',
      status: 'terminated',
      oldStatus: 'pending_approval',
      terminationReason: '我现在没空',
    });
    const arg = toastPush.mock.calls[0]![0] as { level: string };
    expect(arg.level).toBe('warning');
  });

  it('does NOT fire for non-terminated status frames (round_complete, paused, active)', () => {
    render(<Harness />);
    const fire = ipcListeners['dialog.status.changed']!;
    fire({ sessionId: 's1', currentRound: 3, maxRounds: 10 }); // no status field
    fire({ sessionId: 's1', status: 'active' });
    fire({ sessionId: 's1', status: 'paused' });
    expect(toastPush).not.toHaveBeenCalled();
  });

  it('defaults to info when oldStatus is absent (e.g. dialog.terminated push)', () => {
    // The `dialog.terminated` server topic doesn't carry old_status —
    // the IPC transform leaves oldStatus undefined. Without a
    // discriminator we default to the generic info-level toast rather
    // than guessing it was a rejection.
    render(<Harness />);
    const fire = ipcListeners['dialog.status.changed']!;
    fire({ sessionId: 's1', status: 'terminated' });
    expect(toastPush).toHaveBeenCalledTimes(1);
    const arg = toastPush.mock.calls[0]![0] as { level: string };
    expect(arg.level).toBe('info');
  });
});
