/** Fixed-window in-memory limiter. Single instance only; use a shared store if the API is scaled out. */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(private windowMs = 60_000, private now: () => number = Date.now) {}

  /** Returns true if the request is allowed. */
  allow(key: string, limit: number): boolean {
    const t = this.now();
    if (this.windows.size > 10_000) this.prune(t);
    const w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) {
      this.windows.set(key, { start: t, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= limit;
  }

  private prune(t: number) {
    for (const [k, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(k);
  }
}
