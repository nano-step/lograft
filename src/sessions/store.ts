import { randomBytes } from "node:crypto";

export interface SessionStoreOptions {
  ttlMs?: number;
  maxBytes?: number;
  now?: () => number;
}

interface Entry {
  value: unknown;
  bytes: number;
  expiresAt: number;
  lastAccess: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

function approximateSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

export class SessionStore {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private totalBytes = 0;

  constructor(opts: SessionStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.now = opts.now ?? Date.now;
  }

  put(sessionId: string, kind: string, value: unknown): string {
    this.evictExpired();

    const bytes = approximateSize(value);
    if (bytes > this.maxBytes) {
      throw new Error(
        `value too large for session store (${bytes}B > ${this.maxBytes}B cap)`,
      );
    }

    while (this.totalBytes + bytes > this.maxBytes && this.entries.size > 0) {
      this.evictLeastRecentlyUsed();
    }

    const ref = `${sessionId}/${kind}-${randomBytes(4).toString("hex")}`;
    const ts = this.now();
    this.entries.set(ref, {
      value,
      bytes,
      expiresAt: ts + this.ttlMs,
      lastAccess: ts,
    });
    this.totalBytes += bytes;
    return ref;
  }

  get<T = unknown>(ref: string): T | undefined {
    this.evictExpired();
    const entry = this.entries.get(ref);
    if (!entry) return undefined;
    entry.lastAccess = this.now();
    return entry.value as T;
  }

  has(ref: string): boolean {
    this.evictExpired();
    return this.entries.has(ref);
  }

  delete(ref: string): boolean {
    const entry = this.entries.get(ref);
    if (!entry) return false;
    this.totalBytes -= entry.bytes;
    return this.entries.delete(ref);
  }

  clearSession(sessionId: string): number {
    let removed = 0;
    const prefix = `${sessionId}/`;
    for (const ref of this.entries.keys()) {
      if (ref.startsWith(prefix)) {
        this.delete(ref);
        removed++;
      }
    }
    return removed;
  }

  stats(): { entryCount: number; totalBytes: number; maxBytes: number } {
    return {
      entryCount: this.entries.size,
      totalBytes: this.totalBytes,
      maxBytes: this.maxBytes,
    };
  }

  private evictExpired(): void {
    const ts = this.now();
    for (const [ref, entry] of this.entries) {
      if (entry.expiresAt <= ts) {
        this.totalBytes -= entry.bytes;
        this.entries.delete(ref);
      }
    }
  }

  private evictLeastRecentlyUsed(): void {
    let oldestRef: string | undefined;
    let oldestAccess = Infinity;
    for (const [ref, entry] of this.entries) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestRef = ref;
      }
    }
    if (oldestRef) this.delete(oldestRef);
  }
}

export const sharedSessionStore = new SessionStore();
