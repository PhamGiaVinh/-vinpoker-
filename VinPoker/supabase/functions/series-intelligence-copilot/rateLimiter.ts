interface Bucket {
  windowStartedAt: number;
  count: number;
}

export interface ProcessLocalRateLimiterV1 {
  consume(key: string, now?: number): boolean;
  readonly scope: "process_local_prototype";
}

export function createProcessLocalRateLimiterV1(limit = 5, windowMs = 60_000): ProcessLocalRateLimiterV1 {
  const buckets = new Map<string, Bucket>();
  return Object.freeze({
    scope: "process_local_prototype" as const,
    consume(key: string, now = Date.now()): boolean {
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.windowStartedAt >= windowMs) {
        buckets.set(key, { windowStartedAt: now, count: 1 });
        return true;
      }
      if (bucket.count >= limit) return false;
      bucket.count += 1;
      return true;
    },
  });
}
