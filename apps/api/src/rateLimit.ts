import type { RequestHandler } from "express";

const WINDOW_MS = 60_000;

/** Fixed-window, in-memory limiter. IPs are held for at most one minute and never logged. */
export function rateLimit(maxPerWindow: number, now: () => number = Date.now): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req, res, next) => {
    const time = now();
    if (hits.size > 10_000) {
      for (const [key, entry] of hits) if (entry.resetAt <= time) hits.delete(key);
    }
    const key = req.ip ?? "unknown";
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= time) {
      entry = { count: 0, resetAt: time + WINDOW_MS };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > maxPerWindow) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - time) / 1000));
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    next();
  };
}
