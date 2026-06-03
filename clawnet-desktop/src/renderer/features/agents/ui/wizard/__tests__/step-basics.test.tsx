// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { StepBasics } from '../step-basics';
import type { AgentConfig } from '../../../../../../shared/domain/agent';

const updateDraft = vi.fn();
const setSelectedTagId = vi.fn();
let draft: AgentConfig | null = null;
let selectedTagId: string | null = null;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../state/agent-wizard-slice', () => ({
  useAgentWizardStore: (
    selector: (s: {
      draft: AgentConfig | null;
      updateDraft: typeof updateDraft;
      selectedTagId: string | null;
      setSelectedTagId: typeof setSelectedTagId;
    }) => unknown,
  ) => selector({ draft, updateDraft, selectedTagId, setSelectedTagId }),
}));

vi.mock('../../../../tags/hooks/use-tags', () => ({
  useTags: () => ({ data: [{ id: 'tag-1', displayName: 'Friends' }] }),
}));

function makeDraft(over: Partial<AgentConfig> = {}): AgentConfig {
  return {
    displayName: 'My Agent',
    capabilities: [],
    executionMode: 'local',
    proactiveIntensity: 'medium',
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  updateDraft.mockClear();
  setSelectedTagId.mockClear();
  draft = makeDraft();
  selectedTagId = null;
});

describe('StepBasics', () => {
  it('renders null when there is no draft', () => {
    draft = null;
    const { container } = render(<StepBasics />);
    expect(container.firstChild).toBeNull();
  });

  it('typing the display name updates the draft', () => {
    render(<StepBasics />);
    const input = screen.getByDisplayValue('My Agent');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    expect(updateDraft).toHaveBeenCalledWith({ displayName: 'Renamed' });
  });

  it('renders tag options from useTags and selecting one updates the tag id', () => {
    render(<StepBasics />);
    const select = screen.getByTestId('wizard-tag-select');
    expect(screen.getByRole('option', { name: 'Friends' })).toBeTruthy();
    fireEvent.change(select, { target: { value: 'tag-1' } });
    expect(setSelectedTagId).toHaveBeenCalledWith('tag-1');
  });

  it('clearing the tag selection passes null', () => {
    selectedTagId = 'tag-1';
    render(<StepBasics />);
    fireEvent.change(screen.getByTestId('wizard-tag-select'), { target: { value: '' } });
    expect(setSelectedTagId).toHaveBeenCalledWith(null);
  });
});
