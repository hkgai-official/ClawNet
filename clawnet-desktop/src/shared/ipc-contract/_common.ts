// src/shared/ipc-contract/_common.ts
import type { ZodTypeAny, z } from 'zod';

export interface RequestDef<I extends ZodTypeAny, O extends ZodTypeAny> {
  kind: 'request';
  input: I;
  output: O;
}

export interface EventDef<P extends ZodTypeAny> {
  kind: 'event';
  payload: P;
}

export const defineRequest = <I extends ZodTypeAny, O extends ZodTypeAny>(
  spec: { input: I; output: O },
): RequestDef<I, O> => ({ kind: 'request', input: spec.input, output: spec.output });

export const defineEvent = <P extends ZodTypeAny>(payload: P): EventDef<P> => ({
  kind: 'event',
  payload,
});

export type RequestInput<R> = R extends RequestDef<infer I, ZodTypeAny> ? z.infer<I> : never;
export type RequestOutput<R> = R extends RequestDef<ZodTypeAny, infer O> ? z.infer<O> : never;
export type EventPayload<E> = E extends EventDef<infer P> ? z.infer<P> : never;
