// src/shared/ipc-contract/__tests__/contract.p1e.test.ts
import { describe, it, expect } from 'vitest';
import { Requests, Events } from '../index';

describe('IPC contract P1E additions', () => {
  it('agents channels registered', () => {
    expect(Requests['agents.list'].kind).toBe('request');
    expect(Requests['agents.get'].kind).toBe('request');
    expect(Requests['agents.contactable'].kind).toBe('request');
    expect(Events['agent.updated'].kind).toBe('event');
    expect(Events['agent.deleted'].kind).toBe('event');
  });
  it('dialogs channels registered (9 requests + 3 events)', () => {
    for (const k of [
      'dialogs.create', 'dialogs.list', 'dialogs.getByConv', 'dialogs.approve',
      'dialogs.requestMain', 'dialogs.refine', 'dialogs.submitResponse',
      'dialogs.terminate', 'dialogs.extend',
    ]) expect(Requests[k as keyof typeof Requests].kind).toBe('request');
    for (const k of ['dialog.draft.updated', 'dialog.completed']) {
      expect(Events[k as keyof typeof Events].kind).toBe('event');
    }
  });
  it('discovery channels registered', () => {
    for (const k of ['discovery.list', 'discovery.get', 'discovery.getByConv', 'discovery.confirm', 'discovery.cancel']) {
      expect(Requests[k as keyof typeof Requests].kind).toBe('request');
    }
    expect(Events['discovery.statusChanged'].kind).toBe('event');
  });
  it('tasks channels registered', () => {
    for (const k of ['tasks.create', 'tasks.get', 'tasks.approve', 'tasks.cancel', 'tasks.getLogs']) {
      expect(Requests[k as keyof typeof Requests].kind).toBe('request');
    }
    expect(Events['task.statusChanged'].kind).toBe('event');
    expect(Events['task.log.appended'].kind).toBe('event');
  });
  it('audit channels registered', () => {
    expect(Requests['audit.events.list'].kind).toBe('request');
    expect(Events['audit.event'].kind).toBe('event');
  });
  it('file-access channels registered', () => {
    for (const k of ['settings.fileAccess.get', 'settings.fileAccess.update']) {
      expect(Requests[k as keyof typeof Requests].kind).toBe('request');
    }
    expect(Events['fileAccess.changed'].kind).toBe('event');
  });
});
