import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { webhook } from "@line/bot-sdk";
import { filterAllowed, isAllowed, type Allowlist } from "./allowlist";

const allowlist: Allowlist = {
  userIds: new Set(["U1"]),
  groupIds: new Set(["C1", "R1"]),
};

function textEvent(source: webhook.Source | undefined, text = "hi"): webhook.Event {
  return {
    type: "message",
    source,
    replyToken: "rt",
    message: { type: "text", id: "m1", text, quoteToken: "q" },
  } as webhook.Event;
}

describe("isAllowed", () => {
  test("allows a listed user in 1:1 chat", () => {
    expect(isAllowed({ type: "user", userId: "U1" }, allowlist)).toBe(true);
  });

  test("ignores an unlisted user in 1:1 chat", () => {
    expect(isAllowed({ type: "user", userId: "U9" }, allowlist)).toBe(false);
  });

  test("ignores a user source without userId", () => {
    expect(isAllowed({ type: "user" }, allowlist)).toBe(false);
  });

  test("allows any member of a listed group", () => {
    expect(isAllowed({ type: "group", groupId: "C1", userId: "U9" }, allowlist)).toBe(true);
  });

  test("allows a listed group even without userId", () => {
    expect(isAllowed({ type: "group", groupId: "C1" }, allowlist)).toBe(true);
  });

  test("allows a listed user inside an unlisted group", () => {
    expect(isAllowed({ type: "group", groupId: "C9", userId: "U1" }, allowlist)).toBe(true);
  });

  test("ignores an unlisted user in an unlisted group", () => {
    expect(isAllowed({ type: "group", groupId: "C9", userId: "U9" }, allowlist)).toBe(false);
  });

  test("ignores an unlisted group without userId", () => {
    expect(isAllowed({ type: "group", groupId: "C9" }, allowlist)).toBe(false);
  });

  test("checks room IDs against the group list", () => {
    expect(isAllowed({ type: "room", roomId: "R1", userId: "U9" }, allowlist)).toBe(true);
    expect(isAllowed({ type: "room", roomId: "R9", userId: "U9" }, allowlist)).toBe(false);
  });

  test("allows a listed user inside an unlisted room", () => {
    expect(isAllowed({ type: "room", roomId: "R9", userId: "U1" }, allowlist)).toBe(true);
  });

  test("an ID in the group list does not allow a 1:1 chat", () => {
    const list: Allowlist = { userIds: new Set(), groupIds: new Set(["U5"]) };
    expect(isAllowed({ type: "user", userId: "U5" }, list)).toBe(false);
  });

  test("ignores an event without source", () => {
    expect(isAllowed(undefined, allowlist)).toBe(false);
  });

  test("empty allowlist ignores everything", () => {
    const empty: Allowlist = { userIds: new Set(), groupIds: new Set() };
    expect(isAllowed({ type: "user", userId: "U1" }, empty)).toBe(false);
    expect(isAllowed({ type: "group", groupId: "C1", userId: "U1" }, empty)).toBe(false);
  });
});

describe("filterAllowed", () => {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    logSpy.mockClear();
  });

  afterAll(() => {
    logSpy.mockRestore();
  });

  test("keeps allowed events in order and drops the rest", () => {
    const a = textEvent({ type: "user", userId: "U1" }, "a");
    const b = textEvent({ type: "user", userId: "U9" }, "b");
    const c = textEvent({ type: "group", groupId: "C1" }, "c");
    expect(filterAllowed([a, b, c], allowlist)).toEqual([a, c]);
  });

  test("logs one line per ignored event with its IDs, never the message text", () => {
    filterAllowed([textEvent({ type: "group", groupId: "C9", userId: "U9" }, "secret text")], allowlist);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = String(logSpy.mock.calls[0]![0]);
    expect(line).toContain("message");
    expect(line).toContain("C9");
    expect(line).toContain("U9");
    expect(line).not.toContain("secret text");
  });

  test("logs room and unknown sources", () => {
    filterAllowed([textEvent({ type: "room", roomId: "R9" }), textEvent(undefined)], allowlist);
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(String(logSpy.mock.calls[0]![0])).toContain("R9");
    expect(String(logSpy.mock.calls[1]![0])).toContain("unknown source");
  });

  test("does not log allowed events", () => {
    filterAllowed([textEvent({ type: "user", userId: "U1" })], allowlist);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
