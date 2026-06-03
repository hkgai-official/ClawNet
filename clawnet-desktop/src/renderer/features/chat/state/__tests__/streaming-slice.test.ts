import { describe, it, expect, beforeEach } from 'vitest';
import { useStreamingStore } from '../streaming-slice';

beforeEach(() => {
  useStreamingStore.setState({ byId: {} });
});

describe('useStreamingStore', () => {
  it('applyStart inserts entry with empty content', () => {
    useStreamingStore.getState().applyStart({
      messageId: 'm1',
      conversationId: 'c1',
      sender: { id: 'a1', name: 'Agent', type: 'agent' },
    });
    const entry = useStreamingStore.getState().byId['m1'];
    expect(entry?.content).toBe('');
    expect(entry?.conversationId).toBe('c1');
  });

  it('applyDelta updates content and seq', () => {
    useStreamingStore.getState().applyStart({
      messageId: 'm1', conversationId: 'c1',
      sender: { id: 'a1', name: 'A', type: 'agent' },
    });
    useStreamingStore.getState().applyDelta({ messageId: 'm1', content: 'hello', seq: 5 });
    expect(useStreamingStore.getState().byId['m1']?.content).toBe('hello');
    expect(useStreamingStore.getState().byId['m1']?.seq).toBe(5);
  });

  it('applyDelta ignores stale seq (out-of-order delivery)', () => {
    useStreamingStore.getState().applyStart({
      messageId: 'm1', conversationId: 'c1',
      sender: { id: 'a1', name: 'A', type: 'agent' },
    });
    useStreamingStore.getState().applyDelta({ messageId: 'm1', content: 'hello world', seq: 11 });
    useStreamingStore.getState().applyDelta({ messageId: 'm1', content: 'hello', seq: 5 });
    expect(useStreamingStore.getState().byId['m1']?.content).toBe('hello world');
  });

  it('applyEnd removes entry from byId', () => {
    useStreamingStore.getState().applyStart({
      messageId: 'm1', conversationId: 'c1',
      sender: { id: 'a1', name: 'A', type: 'agent' },
    });
    useStreamingStore.getState().applyEnd({ messageId: 'm1' });
    expect(useStreamingStore.getState().byId['m1']).toBeUndefined();
  });

  it('applyCancelled removes entry from byId', () => {
    useStreamingStore.getState().applyStart({
      messageId: 'm1', conversationId: 'c1',
      sender: { id: 'a1', name: 'A', type: 'agent' },
    });
    useStreamingStore.getState().applyCancelled({ messageId: 'm1' });
    expect(useStreamingStore.getState().byId['m1']).toBeUndefined();
  });
});
