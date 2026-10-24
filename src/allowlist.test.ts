import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { webhook } from "@line/bot-sdk";
import { filterDms } from "./allowlist";

function textEvent(source: webhook.Source | undefined, text = "hi"): webhook.Event {
  return {
    type: "message",
    source,
    replyToken: "rt",
    message: { type: "text", id: "m1", text, quoteToken: "q" },
  } as webhook.Event;
}

describe("filterDms", () => {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    logSpy.mockClear();
  });

  afterAll(() => {
    logSpy.mockRestore();
  });

  test("keeps 1:1 chats with a user ID and groups, with or without user ID, in order", () => {
    const a = textEvent({ type: "user", userId: "U9" }, "a");
    const b = textEvent({ type: "group", groupId: "C1", userId: "U1" }, "b");
    const c = textEvent({ type: "group", groupId: "C2" }, "c");
    expect(filterDms([a, b, c])).toEqual([a, b, c]);
  });

  test("drops rooms, user sources without user ID and events without source", () => {
    const kept = textEvent({ type: "user", userId: "U1" });
    const events = [
      textEvent({ type: "room", roomId: "R1", userId: "U1" }),
      textEvent({ type: "user" }),
      textEvent(undefined),
      kept,
    ];
    expect(filterDms(events)).toEqual([kept]);
  });

  test("logs one line per dropped event with its IDs, never the message text", () => {
    filterDms([textEvent({ type: "room", roomId: "R9", userId: "U9" }, "secret text")]);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = String(logSpy.mock.calls[0]![0]);
    expect(line).toContain("message");
    expect(line).toContain("R9");
    expect(line).toContain("U9");
    expect(line).not.toContain("secret text");
  });

  test("logs unknown sources", () => {
    filterDms([textEvent(undefined)]);
    expect(String(logSpy.mock.calls[0]![0])).toContain("unknown source");
  });

  test("does not log kept events", () => {
    filterDms([textEvent({ type: "user", userId: "U1" }), textEvent({ type: "group", groupId: "C1" })]);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
