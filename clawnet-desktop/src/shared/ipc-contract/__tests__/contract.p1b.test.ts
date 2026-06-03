import { describe, it, expect } from 'vitest';
import { Requests, Events } from '../index';

describe('IPC contract P1B additions', () => {
  it('includes auth requests', () => {
    expect(Requests['auth.login'].kind).toBe('request');
    expect(Requests['auth.logout'].kind).toBe('request');
    expect(Requests['auth.restoreSession'].kind).toBe('request');
    expect(Requests['auth.changePassword'].kind).toBe('request');
    expect(Requests['auth.updateServerURL'].kind).toBe('request');
  });

  it('includes connection requests', () => {
    expect(Requests['connection.status'].kind).toBe('request');
    expect(Requests['connection.manualReconnect'].kind).toBe('request');
  });

  it('includes auth and connection events', () => {
    expect(Events['auth.stateChanged'].kind).toBe('event');
    expect(Events['connection.statusChanged'].kind).toBe('event');
  });

  it('auth.login input rejects empty username', () => {
    expect(() => Requests['auth.login'].input.parse({
      serverURL: 'http://x.test', username: '', password: 'p',
    })).toThrow();
  });

  it('connection.statusChanged payload accepts well-formed value', () => {
    const v = Events['connection.statusChanged'].payload.parse({
      status: 'connected', lastError: null, reconnectAttempt: 0,
    });
    expect(v.status).toBe('connected');
  });
});
