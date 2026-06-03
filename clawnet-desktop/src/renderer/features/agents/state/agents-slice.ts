import { create } from 'zustand';

interface AgentsStore {
  activeAgentId: string | null;
  logDrawerOpenForTaskId: string | null;
  setActiveAgent: (id: string | null) => void;
  setLogDrawer: (taskId: string | null) => void;
}

export const useAgentsStore = create<AgentsStore>((set) => ({
  activeAgentId: null,
  logDrawerOpenForTaskId: null,
  setActiveAgent: (id) => set({ activeAgentId: id }),
  setLogDrawer: (taskId) => set({ logDrawerOpenForTaskId: taskId }),
}));
