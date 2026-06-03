// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { StepCapabilities } from '../step-capabilities';
import type { AgentConfig } from '../../../../../../shared/domain/agent';

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
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  updateDraft.mockClear();
  draft = makeDraft();
});

describe('StepCapabilities', () => {
  it('renders null when there is no draft', () => {
    draft = null;
    const { container } = render(<StepCapabilities />);
    expect(container.firstChild).toBeNull();
  });

  it('clicking an unselected capability pill adds it', () => {
    render(<StepCapabilities />);
    fireEvent.click(screen.getByTestId('wizard-cap-web_search'));
    expect(updateDraft).toHaveBeenCalledWith({ capabilities: ['web_search'] });
  });

  it('clicking a selected capability pill removes it', () => {
    draft = makeDraft({ capabilities: ['web_search', 'translation'] });
    render(<StepCapabilities />);
    fireEvent.click(screen.getByTestId('wizard-cap-web_search'));
    expect(updateDraft).toHaveBeenCalledWith({ capabilities: ['translation'] });
  });

  it('selecting an execution mode updates the draft', () => {
    render(<StepCapabilities />);
    fireEvent.click(screen.getByRole('button', { name: 'executionMode.cloud' }));
    expect(updateDraft).toHaveBeenCalledWith({ executionMode: 'cloud' });
  });

  it('selecting a proactive intensity updates the draft', () => {
    render(<StepCapabilities />);
    fireEvent.click(screen.getByRole('button', { name: 'intensity.high' }));
    expect(updateDraft).toHaveBeenCalledWith({ proactiveIntensity: 'high' });
  });
});
