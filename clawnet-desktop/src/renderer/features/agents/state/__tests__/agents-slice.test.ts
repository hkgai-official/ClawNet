import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentsStore } from '../agents-slice';

beforeEach(() => {
  useAgentsStore.setState({ activeAgentId: null, logDrawerOpenForTaskId: null });
});

describe('useAgentsStore', () => {
  it('starts with no active agent and no drawer', () => {
    const s = useAgentsStore.getState();
    expect(s.activeAgentId).toBeNull();
    expect(s.logDrawerOpenForTaskId).toBeNull();
  });
  it('setActiveAgent / setLogDrawer setters work', () => {
    useAgentsStore.getState().setActiveAgent('a1');
    useAgentsStore.getState().setLogDrawer('t1');
    const s = useAgentsStore.getState();
    expect(s.activeAgentId).toBe('a1');
    expect(s.logDrawerOpenForTaskId).toBe('t1');
  });
  it('clearLogDrawer resets', () => {
    useAgentsStore.getState().setLogDrawer('t1');
    useAgentsStore.getState().setLogDrawer(null);
    expect(useAgentsStore.getState().logDrawerOpenForTaskId).toBeNull();
  });
});
