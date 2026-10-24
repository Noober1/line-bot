import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { webhook } from "@line/bot-sdk";
import { createSessionStore, sourceKey } from "./session";

function memoryStore(maxPerSource?: number) {
  return createSessionStore(new Database(":memory:"), maxPerSource);
}

describe("createSessionStore", () => {
  test("recent returns an empty list for a source with no history", () => {
    expect(memoryStore().recent("U1", 10)).toEqual([]);
  });

  test("recent returns messages oldest first", () => {
    const store = memoryStore();
    store.append("U1", "user", "halo");
    store.append("U1", "assistant", "hai");
    expect(store.recent("U1", 10)).toEqual([
      { role: "user", content: "halo" },
      { role: "assistant", content: "hai" },
    ]);
  });

  test("recent returns only the newest `limit` messages", () => {
    const store = memoryStore();
    for (const text of ["a", "b", "c"]) store.append("U1", "user", text);
    expect(store.recent("U1", 2)).toEqual([
      { role: "user", content: "b" },
      { role: "user", content: "c" },
    ]);
  });

  test("histories of different sources are separate", () => {
    const store = memoryStore();
    store.append("U1", "user", "dari U1");
    store.append("C1", "user", "dari grup");
    expect(store.recent("U1", 10)).toEqual([{ role: "user", content: "dari U1" }]);
    expect(store.recent("C1", 10)).toEqual([{ role: "user", content: "dari grup" }]);
  });

  test("clear removes only that source's history", () => {
    const store = memoryStore();
    store.append("U1", "user", "a");
    store.append("U2", "user", "b");
    store.clear("U1");
    expect(store.recent("U1", 10)).toEqual([]);
    expect(store.recent("U2", 10)).toEqual([{ role: "user", content: "b" }]);
  });

  test("append keeps only the newest maxPerSource messages of that source", () => {
    const store = memoryStore(3);
    for (const text of ["1", "2", "3", "4", "5"]) store.append("U1", "user", text);
    store.append("U2", "user", "x");
    expect(store.recent("U1", 10).map((message) => message.content)).toEqual(["3", "4", "5"]);
    expect(store.recent("U2", 10).map((message) => message.content)).toEqual(["x"]);
  });

  test("a second store on the same database keeps existing rows", () => {
    const db = new Database(":memory:");
    createSessionStore(db).append("U1", "user", "tetap");
    expect(createSessionStore(db).recent("U1", 10)).toEqual([{ role: "user", content: "tetap" }]);
  });
});

describe("sourceKey", () => {
  test("a 1:1 chat is keyed by the user ID", () => {
    expect(sourceKey({ type: "user", userId: "U1" })).toBe("U1");
  });

  test("a group is keyed by the group ID, not the sender", () => {
    expect(sourceKey({ type: "group", groupId: "C1", userId: "U1" })).toBe("C1");
  });

  test("a room is keyed by the room ID, not the sender", () => {
    expect(sourceKey({ type: "room", roomId: "R1", userId: "U1" })).toBe("R1");
  });

  test("a missing source has no key", () => {
    expect(sourceKey(undefined)).toBeNull();
  });

  test("a user source without a user ID has no key", () => {
    expect(sourceKey({ type: "user" } as webhook.Source)).toBeNull();
  });
});
