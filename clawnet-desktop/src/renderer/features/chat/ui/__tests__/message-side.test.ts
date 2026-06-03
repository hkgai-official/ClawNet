import { describe, it, expect } from 'vitest';
import { isOwnMessage, isGovernanceCard } from '../message-side';
import type { ChatMessage, Participant } from '../../../../../shared/domain/chat';

const ME = 'user-me';

function human(id: string, ownerId?: string): Participant {
  return { id, name: id, type: 'human', ...(ownerId ? { ownerId } : {}) };
}
function agent(id: string, ownerId?: string): Participant {
  return { id, name: id, type: 'agent', ...(ownerId ? { ownerId } : {}) };
}

describe('isOwnMessage', () => {
  it('a message whose sender.id is me → my side', () => {
    expect(isOwnMessage(human(ME), ME, false)).toBe(true);
  });

  it('a message from another human → other side', () => {
    expect(isOwnMessage(human('user-other'), ME, false)).toBe(false);
  });

  // The regression: A2A dialog, message from MY agent.
  it('A2A dialog: message from my own agent (ownerId === me) → my side', () => {
    const myAgent = agent('agent-default', ME);
    expect(isOwnMessage(myAgent, ME, true)).toBe(true);
  });

  it('A2A dialog: message from the OTHER party agent → other side', () => {
    const theirAgent = agent('agent-bob', 'user-other');
    expect(isOwnMessage(theirAgent, ME, true)).toBe(false);
  });

  it('NON-agent-dialog: my agent does NOT count as my side', () => {
    // Outside an A2A dialog the owner rule must not apply — a normal
    // chat with an agent keeps the agent on the left.
    const myAgent = agent('agent-default', ME);
    expect(isOwnMessage(myAgent, ME, false)).toBe(false);
  });

  it('no currentUserId → falls back to human-vs-agent', () => {
    expect(isOwnMessage(human('x'), null, false)).toBe(true);
    expect(isOwnMessage(agent('x'), null, false)).toBe(false);
  });

  it('placeholder senders (unknown / restored / temp-) → human-vs-agent fallback', () => {
    expect(isOwnMessage(human('unknown'), ME, false)).toBe(true);
    expect(isOwnMessage(agent('restored'), ME, false)).toBe(false);
    expect(isOwnMessage(human('temp-123'), ME, false)).toBe(true);
  });
});

function msg(contentType: ChatMessage['contentType'], content: object = {}): ChatMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    sender: agent('a1'),
    contentType,
    content: content as ChatMessage['content'],
    timestamp: '2026-05-15T00:00:00Z',
  };
}

describe('isGovernanceCard', () => {
  it('dialog_request / dialog_approval / approval_request are governance cards', () => {
    expect(isGovernanceCard(msg('dialog_request'))).toBe(true);
    expect(isGovernanceCard(msg('dialog_approval'))).toBe(true);
    expect(isGovernanceCard(msg('approval_request'))).toBe(true);
  });

  it('rich_card is governance ONLY when cardType is intent_authorization', () => {
    expect(isGovernanceCard(msg('rich_card', { cardType: 'intent_authorization' }))).toBe(true);
    expect(isGovernanceCard(msg('rich_card', { cardType: 'something_else' }))).toBe(false);
    expect(isGovernanceCard(msg('rich_card', {}))).toBe(false);
  });

  it('plain content types are NOT governance cards', () => {
    expect(isGovernanceCard(msg('text', { text: 'hi' }))).toBe(false);
    expect(isGovernanceCard(msg('file'))).toBe(false);
    expect(isGovernanceCard(msg('task_progress'))).toBe(false);
    expect(isGovernanceCard(msg('task_result'))).toBe(false);
  });
});
