import type { IpcEvents } from '../../core/ipc-events';
import type { ChatMessage, Participant } from '../../../shared/domain/chat';

export function emitChatMessageCreated(events: IpcEvents, m: ChatMessage): void {
  events.broadcast('chat.message.created', m);
}

export function emitStreamStart(
  events: IpcEvents,
  e: { messageId: string; conversationId: string; sender: Participant },
): void {
  events.broadcast('chat.stream.start', e);
}

export function emitStreamDelta(
  events: IpcEvents,
  e: { messageId: string; content: string; seq: number },
): void {
  events.broadcast('chat.stream.delta', e);
}

export function emitStreamEnd(
  events: IpcEvents,
  e: { messageId: string; conversationId: string; sender: Participant; finalText: string },
): void {
  events.broadcast('chat.stream.end', e);
}

export function emitStreamCancelled(
  events: IpcEvents,
  e: { messageId: string },
): void {
  events.broadcast('chat.stream.cancelled', e);
}

export function emitUploadProgress(
  events: IpcEvents,
  e: { tempId: string; bytesSent: number; totalBytes: number },
): void {
  events.broadcast('chat.upload.progress', e);
}

export function emitUploadFailed(
  events: IpcEvents,
  e: { tempId: string; reason: string },
): void {
  events.broadcast('chat.upload.failed', e);
}

export function emitChatMessageReplaced(
  events: IpcEvents,
  e: { tempId: string; real: ChatMessage },
): void {
  events.broadcast('chat.message.replaced', e);
}

export function emitDownloadStarted(
  events: IpcEvents,
  e: { messageId: string; totalBytes: number },
): void {
  events.broadcast('chat.download.started', e);
}

export function emitDownloadProgress(
  events: IpcEvents,
  e: { messageId: string; bytesReceived: number; totalBytes: number },
): void {
  events.broadcast('chat.download.progress', e);
}

export function emitDownloadCompleted(
  events: IpcEvents,
  e: { messageId: string; localPath: string },
): void {
  events.broadcast('chat.download.completed', e);
}

export function emitDownloadFailed(
  events: IpcEvents,
  e: { messageId: string; reason: string },
): void {
  events.broadcast('chat.download.failed', e);
}
