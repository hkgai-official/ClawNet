import { useTranslation } from 'react-i18next';
import {
  MessageSquare,
  Users,
  Bot,
  Shield,
  Settings,
  LogOut,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { useFriendRequests } from '../features/contacts/hooks/use-friend-requests';
import { useGlobalSearchStore } from '../features/search/state/global-search-slice';
import { useAuditEventsStore, selectUnreadCount } from '../features/audit/state/audit-events-slice';
import { useAuth } from '../features/auth/hooks/use-auth';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip';
import { cn } from '../lib/cn';
import { FEATURE_FLAGS } from '../lib/feature-flags';
import type { ActivePanel } from './active-panel';

export interface AppSidebarProps {
  active: ActivePanel;
  onChange: (panel: ActivePanel) => void;
}

interface RailButtonProps {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  badge?: number;
  onClick: () => void;
  testId?: string;
}

function RailButton({ label, icon: Icon, active, badge, onClick, testId }: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          data-testid={testId}
          data-active={active ? 'true' : undefined}
          className={cn(
            'relative flex h-9 w-9 items-center justify-center rounded-md',
            'text-(--color-text-muted) hover:text-(--color-text-primary)',
            'hover:bg-(--color-bg-surface-2) transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring-color)',
            active && 'bg-(--color-bg-surface-2) text-(--color-text-primary)',
          )}
        >
          <Icon className="h-5 w-5" />
          {badge !== undefined && badge > 0 && (
            <span
              aria-hidden
              className="absolute top-0.5 right-0.5 inline-flex items-center justify-center rounded-full text-white"
              style={{
                background: 'var(--color-danger)',
                fontSize: 9,
                fontWeight: 700,
                lineHeight: 1,
                minWidth: 14,
                height: 14,
                padding: '0 4px',
              }}
            >
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function AppSidebar({ active, onChange }: AppSidebarProps) {
  const { t } = useTranslation('settings');
  const { t: tSearch } = useTranslation('search');
  const { t: tAudit } = useTranslation('audit');
  const requests = useFriendRequests();
  const pendingCount = requests.data?.length ?? 0;
  const openSearch = useGlobalSearchStore((s) => s.open);
  const auditUnread = useAuditEventsStore(selectUnreadCount);
  const { logout } = useAuth();

  return (
    <TooltipProvider delayDuration={0}>
      <nav
        aria-label={t('nav.label', { defaultValue: 'Navigation' })}
        className="flex h-full w-12 shrink-0 flex-col items-center gap-1 py-2"
        style={{
          background: 'var(--color-bg-surface)',
          borderRight: '1px solid var(--color-border-subtle)',
        }}
      >
        <div
          aria-hidden
          title={t('workspace.personal', { defaultValue: 'Personal' })}
          className="flex h-8 w-8 items-center justify-center rounded-md text-white text-sm font-semibold mb-1"
          style={{ background: 'var(--color-brand-500)' }}
        >
          P
        </div>

        <RailButton
          label={tSearch('title', { defaultValue: 'Search' })}
          icon={Search}
          onClick={openSearch}
          testId="nav-search"
        />
        <RailButton
          label={t('nav.chat', { defaultValue: 'Chat' })}
          icon={MessageSquare}
          active={active === 'chat'}
          onClick={() => onChange('chat')}
        />
        <RailButton
          label={t('nav.contacts', { defaultValue: 'Contacts' })}
          icon={Users}
          active={active === 'contacts'}
          badge={pendingCount}
          onClick={() => onChange('contacts')}
        />
        {FEATURE_FLAGS.agentsRailEnabled && (
          <RailButton
            label={t('nav.agents', { defaultValue: 'Agents' })}
            icon={Bot}
            active={active === 'agents'}
            onClick={() => onChange('agents')}
          />
        )}
        <RailButton
          label={tAudit('navLabel', { defaultValue: 'Security' })}
          icon={Shield}
          active={active === 'security'}
          badge={auditUnread}
          onClick={() => onChange('security')}
        />
        <RailButton
          label={t('nav.settings', { defaultValue: 'Settings' })}
          icon={Settings}
          active={active === 'settings'}
          onClick={() => onChange('settings')}
        />

        <div className="flex-1" />

        <RailButton
          label={t('nav.signOut', { defaultValue: 'Sign out' })}
          icon={LogOut}
          onClick={() => logout.mutate()}
        />
      </nav>
    </TooltipProvider>
  );
}
