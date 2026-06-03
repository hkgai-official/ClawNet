// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { StepPermissions } from '../step-permissions';
import { DEFAULT_AGENT_PERMISSIONS, type AgentConfig } from '../../../../../../shared/domain/agent';

const updateDraft = vi.fn();
let draft: AgentConfig | null = null;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../state/agent-wizard-slice', () => ({
  useAgentWizardStore: (
    selector: (s: { draft: AgentConfig | null; updateDraft: typeof updateDraft }) => unknown,
  ) => selector({ draft, updateDraft }),
}));

function makeDraft(over: Partial<AgentConfig> = {}): AgentConfig {
  return {
    displayName: 'A',
    capabilities: [],
    executionMode: 'local',
    proactiveIntensity: 'medium',
    permissions: { ...DEFAULT_AGENT_PERMISSIONS },
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  updateDraft.mockClear();
  draft = makeDraft();
});

describe('StepPermissions', () => {
  it('renders null when there is no draft', () => {
    draft = null;
    const { container } = render(<StepPermissions />);
    expect(container.firstChild).toBeNull();
  });

  it('toggling a boolean permission patches that key', () => {
    render(<StepPermissions />);
    const cb = screen.getByLabelText('permission.canReadFiles') as HTMLInputElement;
    fireEvent.click(cb);
    expect(updateDraft).toHaveBeenCalled();
    const patch = updateDraft.mock.calls[0]![0] as { permissions: { canReadFiles: boolean } };
    expect(patch.permissions.canReadFiles).toBe(!DEFAULT_AGENT_PERMISSIONS.canReadFiles);
  });

  it('maxConcurrentTasks accepts a positive integer', () => {
    render(<StepPermissions />);
    fireEvent.change(screen.getByLabelText('permission.maxConcurrentTasks'), {
      target: { value: '4' },
    });
    const patch = updateDraft.mock.calls.at(-1)![0] as { permissions: { maxConcurrentTasks: number } };
    expect(patch.permissions.maxConcurrentTasks).toBe(4);
  });

  it('maxConcurrentTasks rejects zero / negative (no update)', () => {
    render(<StepPermissions />);
    fireEvent.change(screen.getByLabelText('permission.maxConcurrentTasks'), {
      target: { value: '0' },
    });
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('requireApprovalFor splits a comma list into a trimmed array', () => {
    render(<StepPermissions />);
    fireEvent.change(screen.getByLabelText('permission.requireApprovalFor'), {
      target: { value: 'file_write, code_execution ' },
    });
    const patch = updateDraft.mock.calls.at(-1)![0] as { permissions: { requireApprovalFor?: string[] } };
    expect(patch.permissions.requireApprovalFor).toEqual(['file_write', 'code_execution']);
  });

  it('an empty requireApprovalFor clears the field to undefined', () => {
    draft = makeDraft({ permissions: { ...DEFAULT_AGENT_PERMISSIONS, requireApprovalFor: ['x'] } });
    render(<StepPermissions />);
    fireEvent.change(screen.getByLabelText('permission.requireApprovalFor'), {
      target: { value: '' },
    });
    const patch = updateDraft.mock.calls.at(-1)![0] as { permissions: { requireApprovalFor?: string[] } };
    expect(patch.permissions.requireApprovalFor).toBeUndefined();
  });
});
