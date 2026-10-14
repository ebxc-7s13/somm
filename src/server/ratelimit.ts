/**
 * In-memory sliding-window rate limiter. Sufficient for a single-process
 * deployment; a multi-instance deployment would move this to a shared store.
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Returns 0 when allowed, otherwise milliseconds until the next allowed hit. */
  check(key: string, limit: number, windowMs: number): number {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => x > t - windowMs);
    if (list.length >= limit) {
      this.hits.set(key, list);
      return list[0]! + windowMs - t;
    }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 50_000) this.prune(windowMs);
    return 0;
  }

  private prune(windowMs: number) {
    const t = this.now();
    for (const [k, v] of this.hits) if (!v.some((x) => x > t - windowMs)) this.hits.delete(k);
  }

  reset() {
    this.hits.clear();
  }
}

export const LIMITS = {
  auth: { limit: 10, windowMs: 60_000 },
  messageBurst: { limit: 5, windowMs: 10_000 },
  messageHourly: { limit: 120, windowMs: 3_600_000 },
  importPreview: { limit: 30, windowMs: 3_600_000 },
  convert: { limit: 30, windowMs: 600_000 },
  reports: { limit: 20, windowMs: 3_600_000 },
  catalogSearch: { limit: 30, windowMs: 60_000 },
  callInvite: { limit: 6, windowMs: 60_000 },
} as const;
