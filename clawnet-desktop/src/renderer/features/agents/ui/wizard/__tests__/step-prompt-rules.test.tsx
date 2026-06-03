// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { StepPromptRules } from '../step-prompt-rules';
import type { AgentConfig, ProactiveRule } from '../../../../../../shared/domain/agent';

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

function rule(over: Partial<ProactiveRule> = {}): ProactiveRule {
  return { id: 'r1', trigger: 't', condition: 'c', action: 'a', enabled: true, ...over };
}

function makeDraft(over: Partial<AgentConfig> = {}): AgentConfig {
  return {
    displayName: 'A',
    capabilities: [],
    executionMode: 'local',
    proactiveIntensity: 'medium',
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  updateDraft.mockClear();
  draft = makeDraft();
});

describe('StepPromptRules', () => {
  it('renders null when there is no draft', () => {
    draft = null;
    const { container } = render(<StepPromptRules />);
    expect(container.firstChild).toBeNull();
  });

  it('editing the system prompt updates the draft', () => {
    render(<StepPromptRules />);
    fireEvent.change(screen.getByPlaceholderText('wizard.systemPromptPlaceholder'), {
      target: { value: 'be concise' },
    });
    expect(updateDraft).toHaveBeenCalledWith({ systemPrompt: 'be concise' });
  });

  it('Add Rule appends a new proactive rule', () => {
    render(<StepPromptRules />);
    fireEvent.click(screen.getByRole('button', { name: /addRule/i }));
    const patch = updateDraft.mock.calls[0]![0] as { proactiveRules: ProactiveRule[] };
    expect(patch.proactiveRules).toHaveLength(1);
  });

  it('editing a rule field patches that rule', () => {
    draft = makeDraft({ proactiveRules: [rule()] });
    render(<StepPromptRules />);
    fireEvent.change(screen.getByPlaceholderText('wizard.ruleTrigger'), {
      target: { value: 'on_message' },
    });
    const patch = updateDraft.mock.calls[0]![0] as { proactiveRules: ProactiveRule[] };
    expect(patch.proactiveRules[0]!.trigger).toBe('on_message');
  });

  it('removing a rule drops it from the list', () => {
    draft = makeDraft({ proactiveRules: [rule({ id: 'r1' }), rule({ id: 'r2' })] });
    render(<StepPromptRules />);
    fireEvent.click(screen.getAllByLabelText('wizard.removeRule')[0]!);
    const patch = updateDraft.mock.calls[0]![0] as { proactiveRules: ProactiveRule[] };
    expect(patch.proactiveRules).toHaveLength(1);
    expect(patch.proactiveRules[0]!.id).toBe('r2');
  });
});
