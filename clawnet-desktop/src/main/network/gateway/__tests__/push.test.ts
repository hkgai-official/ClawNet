import { describe, it, expect, vi } from 'vitest';
import { PushDispatcher } from '../push';

describe('PushDispatcher', () => {
  it('routes to exact-match subscribers', () => {
    const d = new PushDispatcher();
    const cb = vi.fn();
    d.subscribe('chat.message', cb);
    d.dispatch({ type: 'push', topic: 'chat.message', payload: { id: 'm1' } });
    expect(cb).toHaveBeenCalledWith({ id: 'm1' });
  });

  it('routes to prefix subscribers (chat.*)', () => {
    const d = new PushDispatcher();
    const cb = vi.fn();
    d.subscribe('chat.*', cb);
    d.dispatch({ type: 'push', topic: 'chat.message', payload: 'a' });
    d.dispatch({ type: 'push', topic: 'chat.delete', payload: 'b' });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('does not route to unrelated topics', () => {
    const d = new PushDispatcher();
    const cb = vi.fn();
    d.subscribe('chat.*', cb);
    d.dispatch({ type: 'push', topic: 'agent.message', payload: 'x' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('unsubscribe stops further deliveries', () => {
    const d = new PushDispatcher();
    const cb = vi.fn();
    const unsub = d.subscribe('chat.message', cb);
    unsub();
    d.dispatch({ type: 'push', topic: 'chat.message', payload: 'x' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('one push delivers to multiple subscribers', () => {
    const d = new PushDispatcher();
    const a = vi.fn();
    const b = vi.fn();
    d.subscribe('chat.message', a);
    d.subscribe('chat.*', b);
    d.dispatch({ type: 'push', topic: 'chat.message', payload: { id: 'm1' } });
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });
});
