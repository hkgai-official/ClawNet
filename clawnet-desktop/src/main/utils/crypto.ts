import { createHash } from 'node:crypto';

/** SHA256 of a Buffer, lowercase hex. Mirrors macOS `Data.sha256Hex` used in
 *  `ChatService.sendMediaMessage` (ChatService.swift:577). */
export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
