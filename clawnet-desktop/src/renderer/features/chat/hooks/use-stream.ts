import { useStreamingStore } from '../state/streaming-slice';
import { useIpcEvent } from '../../../hooks/use-ipc-event';

export function useStreamEvents(): void {
  const applyStart = useStreamingStore((s) => s.applyStart);
  const applyDelta = useStreamingStore((s) => s.applyDelta);
  const applyEnd = useStreamingStore((s) => s.applyEnd);
  const applyCancelled = useStreamingStore((s) => s.applyCancelled);

  useIpcEvent('chat.stream.start', applyStart);
  useIpcEvent('chat.stream.delta', applyDelta);
  useIpcEvent('chat.stream.end', applyEnd);
  useIpcEvent('chat.stream.cancelled', applyCancelled);
}

export function useStream(messageId: string): { content: string; isStreaming: boolean } {
  const entry = useStreamingStore((s) => s.byId[messageId]);
  return { content: entry?.content ?? '', isStreaming: entry !== undefined };
}
