import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentWizardStore } from '../agent-wizard-slice';
import { DEFAULT_AGENT_PERMISSIONS } from '../../../../../shared/domain/agent';

describe('useAgentWizardStore', () => {
  beforeEach(() => useAgentWizardStore.setState({
    open: false, mode: 'create', editingAgentId: null, step: 0,
    draft: null,
  }));

  it('openForCreate sets initial draft + step 0', () => {
    useAgentWizardStore.getState().openForCreate();
    const s = useAgentWizardStore.getState();
    expect(s.open).toBe(true);
    expect(s.mode).toBe('create');
    expect(s.editingAgentId).toBeNull();
    expect(s.step).toBe(0);
    expect(s.draft?.executionMode).toBe('hybrid');
    expect(s.draft?.proactiveIntensity).toBe('medium');
    expect(s.draft?.capabilities).toEqual([]);
    expect(s.draft?.permissions).toEqual(DEFAULT_AGENT_PERMISSIONS);
  });

  it('openForEdit seeds draft from an existing agent', () => {
    useAgentWizardStore.getState().openForEdit('a1', {
      displayName: 'Existing',
      capabilities: ['web_search'],
      executionMode: 'cloud',
      proactiveIntensity: 'high',
    });
    const s = useAgentWizardStore.getState();
    expect(s.mode).toBe('edit');
    expect(s.editingAgentId).toBe('a1');
    expect(s.draft?.displayName).toBe('Existing');
  });

  it('updateDraft merges partial updates', () => {
    useAgentWizardStore.getState().openForCreate();
    useAgentWizardStore.getState().updateDraft({ displayName: 'Renamed' });
    expect(useAgentWizardStore.getState().draft?.displayName).toBe('Renamed');
  });

  it('next / prev / setStep clamp to [0, 3]', () => {
    useAgentWizardStore.getState().openForCreate();
    const next = useAgentWizardStore.getState().next;
    next(); next(); next(); next(); next();
    expect(useAgentWizardStore.getState().step).toBe(3);
    const prev = useAgentWizardStore.getState().prev;
    prev(); prev(); prev(); prev(); prev();
    expect(useAgentWizardStore.getState().step).toBe(0);
    useAgentWizardStore.getState().setStep(99);
    expect(useAgentWizardStore.getState().step).toBe(3);
    useAgentWizardStore.getState().setStep(-1);
    expect(useAgentWizardStore.getState().step).toBe(0);
  });

  it('close resets state', () => {
    useAgentWizardStore.getState().openForCreate();
    useAgentWizardStore.getState().close();
    expect(useAgentWizardStore.getState().open).toBe(false);
    expect(useAgentWizardStore.getState().draft).toBeNull();
  });
});
