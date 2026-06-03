import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgents } from '../hooks/use-agents';
import { useAgentsStore } from '../state/agents-slice';
import { useAgentWizardStore } from '../state/agent-wizard-slice';
import { Icon } from '../../../components/icon';
import { Button } from '../../../components/ui/button';
import { AgentCreationWizard } from './agent-creation-wizard';
import { DeleteAgentModal } from './delete-agent-modal';
import {
  DEFAULT_AGENT_PERMISSIONS,
  type Agent,
  type AgentConfig,
} from '../../../../shared/domain/agent';

// The Agent response from the live server doesn't carry
// proactiveIntensity / proactiveRules / permissions reliably — these live
// only on AgentConfig at write-time. When opening the wizard in edit mode
// from a fetched Agent, we seed safe defaults; the operator re-enters
// anything they want to change. Matches macOS AgentCreationWizard behavior.
function agentConfigFromAgent(agent: Agent): AgentConfig {
  const out: AgentConfig = {
    displayName: agent.displayName,
    capabilities: agent.capabilities,
    executionMode: agent.executionMode,
    proactiveIntensity: 'medium',
    permissions: DEFAULT_AGENT_PERMISSIONS,
  };
  if (agent.description != null) out.description = agent.description;
  if (agent.avatarUrl != null) out.avatarUrl = agent.avatarUrl;
  if (agent.systemPrompt != null) out.systemPrompt = agent.systemPrompt;
  if (agent.modelProvider != null) out.modelProvider = agent.modelProvider;
  if (agent.modelName != null) out.modelName = agent.modelName;
  return out;
}

export function AgentList() {
  const { t } = useTranslation('agent');
  const { data, isLoading } = useAgents();
  const activeId = useAgentsStore((s) => s.activeAgentId);
  const setActive = useAgentsStore((s) => s.setActiveAgent);
  const openForCreate = useAgentWizardStore((s) => s.openForCreate);
  const openForEdit = useAgentWizardStore((s) => s.openForEdit);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  return (
    <div
      style={{
        minWidth: 'var(--sidebar-width)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {t('navAgents')}
        </span>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={openForCreate}
          aria-label={t('wizard.newAgent')}
        >
          + {t('wizard.newAgent')}
        </Button>
      </div>

      {isLoading ? null : !data || data.length === 0 ? (
        <div className="p-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {t('listEmpty')}
        </div>
      ) : (
        <ul
          className="flex flex-col gap-1 p-2 overflow-y-auto"
          style={{ flex: 1, minHeight: 0 }}
        >
          {/* Mirrors macOS AgentListView.swift:11-13 — tag-delegate agents
              are workers attached to a contact tag, not standalone agents,
              so they don't surface in the main agent list. */}
          {data.filter((a) => a.tagRole !== 'delegate').map((a) => {
            const selected = a.id === activeId;
            return (
              <li key={a.id}>
                <div
                  className="w-full px-3 py-2 flex items-center gap-2"
                  style={{
                    background: selected ? 'var(--color-bg-overlay)' : 'transparent',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setActive(a.id)}
                    className="flex-1 text-left flex items-center gap-2"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'inherit',
                      padding: 0,
                    }}
                  >
                    <Icon name="sparkles" size={18} aria-hidden />
                    <div className="flex-1">
                      <div className="text-sm font-medium truncate">{a.displayName}</div>
                      <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        {t(`status.${a.status}`, { defaultValue: a.status })}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label={t('wizard.editAgent')}
                    onClick={() => openForEdit(a.id, agentConfigFromAgent(a))}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--color-text-secondary)',
                      fontSize: 12,
                      padding: '2px 6px',
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    aria-label={t('wizard.delete')}
                    onClick={() => setDeleteTarget({ id: a.id, name: a.displayName })}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--color-danger)',
                      fontSize: 12,
                      padding: '2px 6px',
                    }}
                  >
                    ✗
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AgentCreationWizard />
      {deleteTarget && (
        <DeleteAgentModal
          agentId={deleteTarget.id}
          agentName={deleteTarget.name}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
