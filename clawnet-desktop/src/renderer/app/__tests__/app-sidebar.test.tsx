// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppSidebar } from '../app-sidebar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? k,
  }),
}));

vi.mock('../../features/contacts/hooks/use-friend-requests', () => ({
  useFriendRequests: () => ({ data: [] }),
}));

vi.mock('../../features/search/state/global-search-slice', () => ({
  useGlobalSearchStore: (selector: (s: { open: () => void }) => unknown) =>
    selector({ open: vi.fn() }),
}));

vi.mock('../../features/audit/state/audit-events-slice', () => ({
  useAuditEventsStore: () => 0,
  selectUnreadCount: vi.fn(),
}));

vi.mock('../../features/auth/hooks/use-auth', () => ({
  useAuth: () => ({ logout: { mutate: vi.fn() } }),
}));

// vi.hoisted lets the factory and the tests share a mutable object —
// flipping `mockFlags.agentsRailEnabled` between tests changes what
// FEATURE_FLAGS.agentsRailEnabled returns on the next render.
const { mockFlags } = vi.hoisted(() => ({
  mockFlags: { agentsRailEnabled: false },
}));
vi.mock('../../lib/feature-flags', () => ({
  FEATURE_FLAGS: mockFlags,
}));

beforeEach(() => {
  cleanup();
  mockFlags.agentsRailEnabled = false;
});

function renderSidebar(props: Partial<React.ComponentProps<typeof AppSidebar>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <AppSidebar active="chat" onChange={onChange} {...props} />
    </QueryClientProvider>,
  );
  return { onChange, ...utils };
}

describe('AppSidebar', () => {
  it('renders the workspace avatar pill with the "P" initial', () => {
    renderSidebar();
    // Icon-only rail: workspace name is conveyed by a 1-letter pill plus a
    // tooltip on hover. Check the pill's title attribute carries "Personal"
    // so screen readers and tooltips still expose the workspace name.
    expect(screen.getByText('P').getAttribute('title')).toBe('Personal');
  });

  it('renders all 4 panel buttons', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: /Chat/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Contacts/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Security|audit/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Settings/i })).toBeTruthy();
  });

  it('marks the active panel via data-active', () => {
    renderSidebar({ active: 'contacts' });
    const btn = screen.getByRole('button', { name: /Contacts/i });
    expect(btn.getAttribute('data-active')).toBe('true');
  });

  it('invokes onChange when a panel is clicked', () => {
    const { onChange } = renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /Settings/i }));
    expect(onChange).toHaveBeenCalledWith('settings');
  });

  it('renders the sign-out button in the footer', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: /Sign out/i })).toBeTruthy();
  });

  it('hides the Agents rail when agentsRailEnabled flag is off', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: /Agents/i })).toBeNull();
  });

  it('shows the Agents rail when agentsRailEnabled flag is on', () => {
    mockFlags.agentsRailEnabled = true;
    renderSidebar();
    expect(screen.getByRole('button', { name: /Agents/i })).toBeTruthy();
  });
});
