import { describe, it, expect } from 'vitest';
import {
  TaskProgressCardDataSchema,
  TaskResultCardDataSchema,
  DialogRequestCardDataSchema,
  DialogApprovalCardDataSchema,
  IntentAuthorizationCardDataSchema,
} from '../card-data';

describe('TaskProgressCardDataSchema (AgentModels.swift:352-358)', () => {
  it('parses with progress as 0..1 fraction', () => {
    const p = TaskProgressCardDataSchema.parse({
      taskId: 't1',
      stage: 'analyzing',
      progress: 0.42,
    });
    expect(p.progress).toBeCloseTo(0.42);
  });

  it('normalizes integer percent (0..100) to fraction', () => {
    const p = TaskProgressCardDataSchema.parse({
      taskId: 't1',
      stage: 'analyzing',
      progress: 42,
    });
    expect(p.progress).toBeCloseTo(0.42);
  });

  it('parses optional details map', () => {
    const p = TaskProgressCardDataSchema.parse({
      taskId: 't1',
      stage: 'x',
      progress: 0,
      details: { filesProcessed: '5' },
    });
    expect(p.details?.filesProcessed).toBe('5');
  });
});

describe('TaskResultCardDataSchema (AgentModels.swift:359-370)', () => {
  it('parses minimal success result', () => {
    const r = TaskResultCardDataSchema.parse({
      taskId: 't1',
      success: true,
      summary: 'done',
    });
    expect(r.success).toBe(true);
  });

  it('parses failure with error + details', () => {
    const r = TaskResultCardDataSchema.parse({
      taskId: 't1',
      success: false,
      summary: 'oops',
      error: 'eperm',
      details: { filesProcessed: 0, logs: ['line a'] },
    });
    expect(r.error).toBe('eperm');
    expect(r.details?.logs).toEqual(['line a']);
  });
});

describe('DialogRequestCardDataSchema (RichCardViews.swift:186-196)', () => {
  it('parses canonical shape', () => {
    const d = DialogRequestCardDataSchema.parse({
      topic: 'sync calendars',
      status: 'pending',
      myAgent: { displayName: 'Helper' },
      targetAgent: { displayName: 'Other' },
      contactTag: { displayName: 'work' },
      targetOwner: { id: 'u-other' },
    });
    expect(d.targetOwner?.id).toBe('u-other');
  });

  it('parses minimal (status only)', () => {
    const d = DialogRequestCardDataSchema.parse({ status: 'confirmed' });
    expect(d.status).toBe('confirmed');
  });
});

describe('DialogApprovalCardDataSchema (RichCardViews.swift:293-307)', () => {
  it('parses canonical shape with sessionId for the approve action', () => {
    const d = DialogApprovalCardDataSchema.parse({
      topic: 't',
      status: 'pending',
      initiatorAgent: { displayName: 'A' },
      initiatorOwner: { id: 'u1', displayName: 'Alice' },
      myAgent: { displayName: 'B' },
      sessionId: 'sess-1',
    });
    expect(d.sessionId).toBe('sess-1');
  });
});

describe('IntentAuthorizationCardDataSchema (RichCardViews.swift:408-415)', () => {
  it('parses with isMainAgent + targets list', () => {
    const i = IntentAuthorizationCardDataSchema.parse({
      cardType: 'intent_authorization',
      authorizationId: 'auth-1',
      agentName: 'Default',
      status: 'pending',
      isMainAgent: false,
      targets: [
        { target_user_name: 'Bob', contact_tag_display_name: 'family', topic: 'hi' },
      ],
    });
    expect(i.authorizationId).toBe('auth-1');
    expect(i.targets[0]?.target_user_name).toBe('Bob');
  });

  it('rejects when cardType is not intent_authorization', () => {
    expect(() =>
      IntentAuthorizationCardDataSchema.parse({
        cardType: 'something_else',
        authorizationId: 'x',
        status: 'pending',
        targets: [],
      }),
    ).toThrow();
  });

  it('parses target_agent_name and contact_tag_name on targets[]', () => {
    const i = IntentAuthorizationCardDataSchema.parse({
      cardType: 'intent_authorization',
      authorizationId: 'auth-1',
      agentName: 'Default',
      status: 'pending',
      isMainAgent: false,
      targets: [
        {
          target_user_name: 'Bob',
          target_agent_name: 'friends（助理）',
          contact_tag_name: 'default',
          contact_tag_display_name: 'family',
          topic: 'hi',
        },
      ],
    });
    expect(i.targets[0]?.target_agent_name).toBe('friends（助理）');
    expect(i.targets[0]?.contact_tag_name).toBe('default');
  });
});
