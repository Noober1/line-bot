import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createAutoTranslateStore } from "./auto-translate";

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

  test("the state survives a new store on the same database", () => {
    const db = new Database(":memory:");
    createAutoTranslateStore(db).toggle("C1", "U1");
    expect(createAutoTranslateStore(db).isOn("C1", "U1")).toBe(true);
  });
});
