// e2e/fixtures/responses.ts
// Canned responses for the fake clawnet-server.
//
// NOTE: all REST response fixtures here are server-wire format (snake_case keys).
// HttpClient (commit 24ef910) converts to camelCase on receive, so the renderer
// + zod schemas see camelCase. Keep these in snake to mirror the real server.
// Enum values mirror the macOS-canonical truth (post-3dbbc60):
//   - FileAccessMode ∈ deny | scoped | full
//   - AgentStatus    ∈ online | busy | offline | error
//   - ExecutionMode  ∈ local | cloud | hybrid

function makeJwt(expSecondsFromNow: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = Buffer.from(JSON.stringify({ exp, sub: 'u-e2e' })).toString('base64url');
  return `${header}.${payload}.sig`;
}

export const LOGIN_RESPONSE = {
  data: {
    user: {
      id: 'u-e2e',
      email: 'e2e@clawnet.test',
      display_name: 'E2E User',
      user_code: 'C0001',
    },
    tokens: {
      access_token: makeJwt(3600),
      refresh_token: 'rt-e2e',
    },
  },
};

export const CONVERSATIONS_RESPONSE = {
  data: [
    {
      id: 'c-agent',
      type: 'direct',
      participants: [
        { id: 'u-e2e', name: 'E2E User', type: 'human' },
        { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
      ],
      last_message_preview: 'Hi there!',
      last_message_at: '2026-05-09T10:00:00Z',
      unread_count: 0,
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-05-09T10:00:00Z',
    },
  ],
};

export const MESSAGES_RESPONSE = {
  data: [
    {
      id: 'm-hello',
      conversation_id: 'c-agent',
      sender: { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
      content_type: 'text',
      content: { text: 'Hi there!' },
      timestamp: '2026-05-09T10:00:00Z',
      status: 'sent',
    },
    {
      id: 'm-task-progress',
      conversation_id: 'c-agent',
      sender: { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
      content_type: 'task_progress',
      content: {
        task_id: 'tp-1',
        stage: 'Analyzing payload',
        progress: 42,
        details: { filesProcessed: '5' },
      },
      timestamp: '2026-05-12T10:00:01Z',
      status: 'sent',
    },
    {
      id: 'm-task-result',
      conversation_id: 'c-agent',
      sender: { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
      content_type: 'task_result',
      content: {
        task_id: 'tp-1',
        success: true,
        summary: 'Processed 5 files',
        details: { filesProcessed: 5, logs: ['OK', 'OK'] },
      },
      timestamp: '2026-05-12T10:00:02Z',
      status: 'sent',
    },
    {
      id: 'm-approval',
      conversation_id: 'c-agent',
      sender: { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
      content_type: 'approval_request',
      content: { id: 'ar-1', name: 'file_write', text: 'Write config.json' },
      timestamp: '2026-05-12T10:00:03Z',
      status: 'sent',
    },
    {
      id: 'm-dialog-request',
      conversation_id: 'c-agent',
      sender: { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
      content_type: 'dialog_request',
      content: {
        topic: 'sync calendars',
        status: 'confirmed',
        my_agent: { display_name: 'Helper' },
        target_agent: { display_name: 'Other Helper' },
        target_owner: { id: 'u-other' },
      },
      timestamp: '2026-05-12T10:00:04Z',
      status: 'sent',
    },
    {
      id: 'm-rich-card',
      conversation_id: 'c-agent',
      sender: { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
      content_type: 'rich_card',
      content: {
        name: 'execution.log',
        text: 'log_level: debug\nstarting subsystem',
        mime_type: 'execution_log',
      },
      timestamp: '2026-05-12T10:00:05Z',
      status: 'sent',
    },
    {
      id: 'm-dialog-status',
      conversation_id: 'c-agent',
      sender: { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
      content_type: 'dialog_status',
      content: { text: 'Dialog terminated after 3 rounds' },
      timestamp: '2026-05-12T10:00:06Z',
      status: 'sent',
    },
  ],
  meta: { page: 1, page_size: 50, total: 7, has_more: false },
};

export const FILE_ACCESS_SETTINGS_RESPONSE = {
  data: {
    mode: 'full' as const,
    allowed_paths: [] as string[],
    denied_paths: [] as string[],
    default_denied_paths: ['C:\\Windows'],
  },
};

// -- P2C --

export const CONTACTS_RESPONSE = {
  data: [
    { id: 'u-other-1', display_name: 'Alice E2E', type: 'human', user_code: 'A001', email: 'alice@x' },
    { id: 'u-other-2', display_name: 'Bob E2E', type: 'human', user_code: 'B002', email: 'bob.e@x' },
    { id: 'a-helper', display_name: 'Helper Agent', type: 'agent' },
  ],
};

export const CONTACT_SEARCH_RESULTS = {
  data: [
    { id: 'u-new-friend', display_name: 'Bob Test', type: 'human', user_code: 'B001', email: 'bob@x' },
  ],
};

// -- P2D --

export const GROUP_CONVERSATION_SEED = {
  id: 'c-group-seed',
  type: 'group' as const,
  title: 'Project Sync',
  participants: [
    { id: 'u-e2e', name: 'E2E User', type: 'human' as const, role: 'owner' as const },
    { id: 'u-other-1', name: 'Alice E2E', type: 'human' as const, role: 'member' as const },
    { id: 'u-other-2', name: 'Bob E2E', type: 'human' as const, role: 'member' as const },
  ],
  unread_count: 0,
  created_at: '2026-05-12T00:00:00Z',
  updated_at: '2026-05-12T00:00:00Z',
};

export const FRIEND_REQUESTS_RESPONSE = {
  data: [
    {
      id: 'fr-1',
      from_user_id: 'u-incoming-1', from_user_name: 'Charlie Pending', from_user_code: 'C001',
      to_user_id: 'u-e2e', to_user_name: 'E2E User',
      status: 'pending',
      message: 'hi please add me',
      created_at: '2026-05-12T08:00:00Z',
    },
  ],
};

// -- P2F: global search fixtures --
// `CONTACT_SEARCH_RESULTS` (P2C) is reused for the contacts pane in the
// search modal. Messages + files get their own fixture.
//
// The message hit id (`m-hello`) intentionally matches the first item in
// MESSAGES_RESPONSE so clicking the search result jumps to a message that
// actually exists in the conversation message-list — that's how the
// MessageList flashing test works (the testid lookup needs a real DOM node).
export const SEARCH_MESSAGES_RESPONSE = {
  data: [
    {
      id: 'm-hello',
      conversation_id: 'c-agent',
      sender: { id: 'a-helper', name: 'Helper Agent', type: 'agent' },
      content_type: 'text',
      content: { text: 'Hi there!' },
      timestamp: '2026-05-09T10:00:00Z',
      status: 'sent',
    },
  ],
};

export const SEARCH_FILES_RESPONSE = {
  data: [
    { id: 'f-search', name: 'report.pdf', size: 12345, mime_type: 'application/pdf' },
  ],
};
