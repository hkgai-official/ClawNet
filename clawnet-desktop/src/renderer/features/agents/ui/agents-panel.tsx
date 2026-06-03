import { AgentList } from './agent-list';
import { AgentProfile } from './agent-profile';

export function AgentsPanel() {
  return (
    <div className="flex h-full" style={{ background: 'var(--color-bg-app)' }}>
      <aside
        style={{
          minWidth: 'var(--sidebar-width)',
          maxWidth: 'var(--sidebar-width)',
          borderRight: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-surface)',
        }}
      >
        <AgentList />
      </aside>
      <section className="flex-1 overflow-y-auto">
        <AgentProfile />
      </section>
    </div>
  );
}
