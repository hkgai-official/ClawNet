import { create } from 'zustand';
import {
  DEFAULT_AGENT_PERMISSIONS,
  type AgentConfig,
} from '../../../../shared/domain/agent';

export type WizardMode = 'create' | 'edit';

interface AgentWizardState {
  open: boolean;
  mode: WizardMode;
  editingAgentId: string | null;
  step: number; // 0..3
  draft: AgentConfig | null;
  // P3A Task 13: tag selected in the wizard's basics step. Tracked
  // separately from `draft` because tagId is NOT part of AgentConfig —
  // it's a top-level argument to the create/update mutation.
  selectedTagId: string | null;

  openForCreate(): void;
  openForEdit(agentId: string, seedConfig: AgentConfig): void;
  updateDraft(patch: Partial<AgentConfig>): void;
  setSelectedTagId(tagId: string | null): void;
  setStep(step: number): void;
  next(): void;
  prev(): void;
  close(): void;
}

const STEP_MIN = 0;
const STEP_MAX = 3;

const INITIAL_CREATE_DRAFT: AgentConfig = {
  displayName: '',
  capabilities: [],
  executionMode: 'hybrid',
  proactiveIntensity: 'medium',
  permissions: DEFAULT_AGENT_PERMISSIONS,
};

export const useAgentWizardStore = create<AgentWizardState>((set, get) => ({
  open: false,
  mode: 'create',
  editingAgentId: null,
  step: 0,
  draft: null,
  selectedTagId: null,
  openForCreate: () => set({
    open: true,
    mode: 'create',
    editingAgentId: null,
    step: 0,
    draft: { ...INITIAL_CREATE_DRAFT, permissions: { ...DEFAULT_AGENT_PERMISSIONS } },
    selectedTagId: null,
  }),
  openForEdit: (agentId, seedConfig) => set({
    open: true,
    mode: 'edit',
    editingAgentId: agentId,
    step: 0,
    draft: seedConfig,
    selectedTagId: null,
  }),
  updateDraft: (patch) => {
    const cur = get().draft;
    if (!cur) return;
    set({ draft: { ...cur, ...patch } });
  },
  setSelectedTagId: (tagId) => set({ selectedTagId: tagId }),
  setStep: (step) => set({ step: Math.min(Math.max(STEP_MIN, step), STEP_MAX) }),
  next: () => set((s) => ({ step: Math.min(s.step + 1, STEP_MAX) })),
  prev: () => set((s) => ({ step: Math.max(s.step - 1, STEP_MIN) })),
  close: () => set({
    open: false, mode: 'create', editingAgentId: null, step: 0, draft: null, selectedTagId: null,
  }),
}));
