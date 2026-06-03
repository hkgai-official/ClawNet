import { describe, it, expect } from 'vitest';
import {
  HelloFrameSchema,
  HelloOkFrameSchema,
  PingFrameSchema,
  PongFrameSchema,
  PushFrameSchema,
  GatewayFrameSchema,
  RpcRequestFrameSchema,
} from '../gateway-models';

describe('gateway-models', () => {
  it('HelloFrameSchema parses canonical hello payload', () => {
    const v = HelloFrameSchema.parse({
      type: 'hello',
      role: 'unified',
      scopes: ['operator.admin'],
      caps: ['screen'],
      commands: [],
      permissions: {},
      client_id: 'c1',
      client_mode: 'clawnet',
      client_display_name: 'Win',
    });
    expect(v.type).toBe('hello');
    expect(v.role).toBe('unified');
  });

  it('HelloOkFrameSchema accepts hello_ok with protocol version', () => {
    const v = HelloOkFrameSchema.parse({ type: 'hello_ok', protocol: 'v1' });
    expect(v.protocol).toBe('v1');
  });

  it('PingFrameSchema / PongFrameSchema parse', () => {
    expect(PingFrameSchema.parse({ type: 'ping' }).type).toBe('ping');
    expect(PongFrameSchema.parse({ type: 'pong' }).type).toBe('pong');
  });

  it('PushFrameSchema accepts topic + arbitrary payload', () => {
    const v = PushFrameSchema.parse({
      type: 'push',
      topic: 'chat.message',
      payload: { id: 'm1', text: 'hi' },
    });
    expect(v.topic).toBe('chat.message');
  });

  it('GatewayFrameSchema discriminates by type', () => {
    expect(GatewayFrameSchema.parse({ type: 'ping' }).type).toBe('ping');
    expect(GatewayFrameSchema.parse({ type: 'push', topic: 't', payload: {} }).type).toBe('push');
    // The open-envelope branch (ServerMessageFrameSchema) accepts arbitrary
    // event-type strings — anything that isn't a connection-lifecycle frame
    // routes through as a server-proxied event.
    expect(GatewayFrameSchema.parse({ type: 'message.new', data: { x: 1 } }).type).toBe('message.new');
  });
});

describe('RpcRequestFrameSchema (P3C-agent-exec-protocol)', () => {
  it('parses a canonical node.invoke.result outbound frame', () => {
    const result = RpcRequestFrameSchema.safeParse({
      type: 'request',
      method: 'node.invoke.result',
      params: { id: 'invoke-1', result: '{"basePath":"/x","results":[]}' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects frames with the wrong type discriminator', () => {
    const result = RpcRequestFrameSchema.safeParse({
      type: 'push', method: 'foo', params: {},
    });
    expect(result.success).toBe(false);
  });

  it('requires method to be a non-empty string', () => {
    const result = RpcRequestFrameSchema.safeParse({
      type: 'request', method: '', params: {},
    });
    expect(result.success).toBe(false);
  });

  it('accepts any object as params (intentionally permissive at frame layer)', () => {
    const result = RpcRequestFrameSchema.safeParse({
      type: 'request', method: 'node.invoke.result', params: { id: 'x', nested: { k: 1 } },
    });
    expect(result.success).toBe(true);
  });
});
