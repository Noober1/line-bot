import { describe, expect, test } from "bun:test";
import { createRateLimit } from "./ratelimit";

describe("createRateLimit", () => {
  test("allows up to max messages per window", () => {
    const limit = createRateLimit(3, 60_000, () => 0);
    expect([limit("U1"), limit("U1"), limit("U1")]).toEqual(["allow", "allow", "allow"]);
  });
  test("the first message over the limit is notify, the rest drop", () => {
    const limit = createRateLimit(1, 60_000, () => 0);
    limit("U1");
    expect([limit("U1"), limit("U1")]).toEqual(["notify", "drop"]);
  });
  test("a new window starts fresh", () => {
    let now = 0;
    const limit = createRateLimit(1, 60_000, () => now);
    limit("U1"); limit("U1");
    now = 60_000;
    expect(limit("U1")).toBe("allow");
  });
  test("each source has its own window", () => {
    const limit = createRateLimit(1, 60_000, () => 0);
    limit("U1");
    expect(limit("C1")).toBe("allow");
  });
  test("expired windows are purged so the map does not grow", () => {
    let now = 0;
    const windows = new Map<string, { start: number; count: number }>();
    const limit = createRateLimit(1, 60_000, () => now, windows);
    limit("U1"); limit("U2");
    now = 60_000;
    limit("U3");
    expect([...windows.keys()]).toEqual(["U3"]);
  });
  test("a purge does not reset a window still running", () => {
    let now = 0;
    const limit = createRateLimit(1, 60_000, () => now);
    limit("U1");
    now = 30_000;
    limit("U2");
    now = 60_000;
    expect(limit("U1")).toBe("allow");
    now = 60_001;
    expect(limit("U2")).toBe("notify");
  });
  test("max 0 never limits", () => {
    const limit = createRateLimit(0);
    for (let i = 0; i < 100; i++) expect(limit("U1")).toBe("allow");
  });
});
