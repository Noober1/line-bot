// allow: handle the message. notify: first one over the limit, send the notice. drop: ignore silently.
export type RateLimitVerdict = "allow" | "notify" | "drop";
export type RateLimit = (key: string) => RateLimitVerdict;

export const RATE_LIMIT_WINDOW_MS = 60_000;

// shortcut: in-memory fixed window; resets on restart and lets up to 2x max through around a window edge.
// Entries are never removed: the allowlist bounds the number of sources.
export function createRateLimit(max: number, windowMs = RATE_LIMIT_WINDOW_MS, now: () => number = Date.now): RateLimit {
  const windows = new Map<string, { start: number; count: number }>();
  return (key) => {
    if (max === 0) return "allow";
    const time = now();
    let window = windows.get(key);
    if (!window || time - window.start >= windowMs) {
      window = { start: time, count: 0 };
      windows.set(key, window);
    }
    window.count++;
    if (window.count <= max) return "allow";
    return window.count === max + 1 ? "notify" : "drop";
  };
}
