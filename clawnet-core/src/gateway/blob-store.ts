import { randomUUID } from "node:crypto";

type BlobEntry = {
  data: Buffer;
  createdAtMs: number;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

/**
 * Ephemeral in-memory blob store for transferring large binary payloads
 * between Nodes and agent tools via HTTP instead of WebSocket.
 *
 * Blobs are one-time-use: `take()` retrieves and deletes.
 * Unclaimed blobs are garbage-collected after the TTL expires.
 */
export class BlobStore {
  private blobs = new Map<string, BlobEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private ttlMs = DEFAULT_TTL_MS) {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    // Prevent the timer from keeping the Node.js process alive.
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /** Store binary data and return a unique blob ID. */
  put(data: Buffer): string {
    const id = randomUUID();
    this.blobs.set(id, { data, createdAtMs: Date.now() });
    return id;
  }

  /** Retrieve and delete a blob (one-time use). Returns null if not found or expired. */
  take(id: string): Buffer | null {
    const entry = this.blobs.get(id);
    if (!entry) {
      return null;
    }
    this.blobs.delete(id);
    return entry.data;
  }

  get size(): number {
    return this.blobs.size;
  }

  private cleanup() {
    const now = Date.now();
    for (const [id, entry] of this.blobs) {
      if (now - entry.createdAtMs > this.ttlMs) {
        this.blobs.delete(id);
      }
    }
  }

  dispose() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.blobs.clear();
  }
}
