// MIME utility mirroring the macOS app's behaviour in
// `ChatService.mimeType(for:)` and `ChatService.mediaContentType(for:)`
// (ChatService.swift:612-…).

const EXT_MAP: Record<string, string> = {
  // images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  // videos
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  // audio
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  // documents
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
};

export function mimeFromExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot < 0) return 'application/octet-stream';
  const ext = filename.slice(lastDot + 1).toLowerCase();
  return EXT_MAP[ext] ?? 'application/octet-stream';
}

/** Map MIME type to `MessageContentType` raw value, mirroring Swift
 *  `ChatService.mediaContentType(for:)`. */
export function mediaContentType(mime: string): 'image' | 'video' | 'voice' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'voice';
  return 'file';
}
