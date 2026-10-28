import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { CONTEXT_CHARS, CONTEXT_MESSAGES, createAutoTranslateStore } from "./auto-translate";

describe("auto-translate store", () => {
  test("toggle flips on and off and returns the new state", () => {
    const store = createAutoTranslateStore(new Database(":memory:"));
    expect(store.isOn("C1", "U1")).toBe(false);
    expect(store.toggle("C1", "U1")).toBe(true);
    expect(store.isOn("C1", "U1")).toBe(true);
    expect(store.toggle("C1", "U1")).toBe(false);
    expect(store.isOn("C1", "U1")).toBe(false);
  });

  test("the switch is per user per group", () => {
    const store = createAutoTranslateStore(new Database(":memory:"));
    store.toggle("C1", "U1");
    expect(store.isOn("C1", "U2")).toBe(false);
    expect(store.isOn("C2", "U1")).toBe(false);
  });

  test("remembers the last CONTEXT_MESSAGES messages, oldest first, each cut to CONTEXT_CHARS", () => {
    const store = createAutoTranslateStore(new Database(":memory:"));
    store.toggle("C1", "U1");
    for (const text of ["a", "b", "c", "d"]) store.remember("C1", "U1", text);
    expect(store.recent("C1", "U1")).toEqual(["b", "c", "d"]);
    store.remember("C1", "U1", "x".repeat(CONTEXT_CHARS + 50));
    expect(store.recent("C1", "U1").at(-1)).toHaveLength(CONTEXT_CHARS);
    expect(store.recent("C1", "U1")).toHaveLength(CONTEXT_MESSAGES);
  });

  test("context is per user per group, and nothing is kept for a sender who is off", () => {
    const store = createAutoTranslateStore(new Database(":memory:"));
    store.toggle("C1", "U1");
    store.remember("C1", "U1", "halo");
    store.remember("C1", "U2", "off user");
    expect(store.recent("C1", "U2")).toEqual([]);
    expect(store.recent("C2", "U1")).toEqual([]);
    expect(store.recent("C1", "U1")).toEqual(["halo"]);
  });

  test("switching off clears the context", () => {
    const store = createAutoTranslateStore(new Database(":memory:"));
    store.toggle("C1", "U1");
    store.remember("C1", "U1", "halo");
    store.toggle("C1", "U1");
    store.toggle("C1", "U1");
    expect(store.recent("C1", "U1")).toEqual([]);
  });

  test("an instruction sticks until replaced, and is cleared when switching off", () => {
    const store = createAutoTranslateStore(new Database(":memory:"));
    store.toggle("C1", "U1");
    store.remember("C1", "U1", "a", "kansai");
    store.remember("C1", "U1", "b");
    expect(store.instruction("C1", "U1")).toBe("kansai");
    store.remember("C1", "U1", "c", "sopan");
    expect(store.instruction("C1", "U1")).toBe("sopan");
    expect(store.instruction("C1", "U2")).toBeUndefined();
    store.toggle("C1", "U1");
    store.toggle("C1", "U1");
    expect(store.instruction("C1", "U1")).toBeUndefined();
  });

  test("context is memory only: a new store on the same database starts empty", () => {
    const db = new Database(":memory:");
    const first = createAutoTranslateStore(db);
    first.toggle("C1", "U1");
    first.remember("C1", "U1", "halo");
    expect(createAutoTranslateStore(db).recent("C1", "U1")).toEqual([]);
  });

  test("the state survives a new store on the same database", () => {
    const db = new Database(":memory:");
    createAutoTranslateStore(db).toggle("C1", "U1");
    expect(createAutoTranslateStore(db).isOn("C1", "U1")).toBe(true);
  });
});
