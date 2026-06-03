// src/renderer/features/chat/hooks/use-is-streaming.ts
//
// True when at least one streaming entry exists in useStreamingStore.byId.
// Mirrors macOS StatusBarView's `isStreaming` prop, which is fed from
// AppState (chat-level "is any agent currently generating?").

import { useStreamingStore } from '../state/streaming-slice';

export function useIsStreaming(): boolean {
  return useStreamingStore((s) => Object.keys(s.byId).length > 0);
}
