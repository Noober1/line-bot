import { Database } from "bun:sqlite";
import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { webhook } from "@line/bot-sdk";
import { handleEvents } from "./events";
import { createSessionStore, type SessionStore } from "./session";

const USER_U1: webhook.Source = { type: "user", userId: "U1" };
const USER_U2: webhook.Source = { type: "user", userId: "U2" };

function textEvent(text: string, replyToken?: string, source?: webhook.Source): webhook.Event {
  return {
    type: "message",
    replyToken,
    source,
    message: { type: "text", id: "m1", text, quoteToken: "q" },
  } as webhook.Event;
}

function okReply() {
  return mock(async (_replyToken: string, _text: string) => {});
}

describe("handleEvents", () => {
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});
  let sessions: SessionStore;

  beforeEach(() => {
    errorSpy.mockClear();
    sessions = createSessionStore(new Database(":memory:"));
  });

  afterAll(() => {
    errorSpy.mockRestore();
  });

  test("echoes a text message using its reply token", async () => {
    const reply = okReply();
    await handleEvents([textEvent("hello", "rt-1")], reply, sessions);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith("rt-1", "hello");
  });

  test("echoes every text message in one batch", async () => {
    const reply = okReply();
    await handleEvents([textEvent("a", "rt-a"), textEvent("b", "rt-b")], reply, sessions);
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply).toHaveBeenCalledWith("rt-a", "a");
    expect(reply).toHaveBeenCalledWith("rt-b", "b");
  });

  test("replies to a command instead of echoing it", async () => {
    const reply = okReply();
    await handleEvents([textEvent("/ping", "rt-1")], reply, sessions);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith("rt-1", "pong");
  });

  test("answers an unknown command with a friendly error", async () => {
    const reply = okReply();
    await handleEvents([textEvent("/foo", "rt-1")], reply, sessions);
    expect(reply).toHaveBeenCalledWith(
      "rt-1",
      "Perintah /foo tidak dikenal. Ketik /help untuk daftar perintah.",
    );
  });

  test("ignores non-text messages", async () => {
    const reply = okReply();
    const sticker = {
      type: "message",
      replyToken: "rt-1",
      message: { type: "sticker", id: "m1", packageId: "1", stickerId: "1" },
    } as webhook.Event;
    await handleEvents([sticker], reply, sessions);
    expect(reply).not.toHaveBeenCalled();
  });

  test("ignores non-message events even with a reply token", async () => {
    const reply = okReply();
    const follow = { type: "follow", replyToken: "rt-1", follow: { isUnblocked: false } } as webhook.Event;
    await handleEvents([follow], reply, sessions);
    expect(reply).not.toHaveBeenCalled();
  });

  test("ignores text messages without a reply token", async () => {
    const reply = okReply();
    await handleEvents([textEvent("hello")], reply, sessions);
    expect(reply).not.toHaveBeenCalled();
  });

  test("a failed reply is logged and does not stop other replies", async () => {
    const reply = mock(async (replyToken: string, _text: string) => {
      if (replyToken === "rt-bad") throw new Error("boom");
    });
    await handleEvents([textEvent("x", "rt-bad"), textEvent("y", "rt-ok")], reply, sessions);
    expect(reply).toHaveBeenCalledWith("rt-ok", "y");
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test("never rejects when every reply fails", async () => {
    const reply = mock(async () => {
      throw new Error("boom");
    });
    await expect(handleEvents([textEvent("x", "rt-1")], reply, sessions)).resolves.toBeUndefined();
  });

  test("saves a text message and its reply to the sender's history", async () => {
    await handleEvents([textEvent("halo", "rt-1", USER_U1)], okReply(), sessions);
    expect(sessions.recent("U1", 10)).toEqual([
      { role: "user", content: "halo" },
      { role: "assistant", content: "halo" },
    ]);
  });

  test("messages in a group go to the group's shared history", async () => {
    const events = [
      textEvent("dari U1", "rt-1", { type: "group", groupId: "C1", userId: "U1" }),
      textEvent("dari U2", "rt-2", { type: "group", groupId: "C1", userId: "U2" }),
    ];
    await handleEvents(events, okReply(), sessions);
    expect(sessions.recent("C1", 10)).toHaveLength(4);
    expect(sessions.recent("U1", 10)).toEqual([]);
    expect(sessions.recent("U2", 10)).toEqual([]);
  });

  test("does not save commands", async () => {
    await handleEvents([textEvent("/ping", "rt-1", USER_U1)], okReply(), sessions);
    expect(sessions.recent("U1", 10)).toEqual([]);
  });

  test("/reset clears only the current chat's history", async () => {
    sessions.append("U1", "user", "lama");
    sessions.append("U2", "user", "punya U2");
    const reply = okReply();
    await handleEvents([textEvent("/reset", "rt-1", USER_U1)], reply, sessions);
    expect(reply).toHaveBeenCalledWith("rt-1", "Riwayat chat sudah dihapus.");
    expect(sessions.recent("U1", 10)).toEqual([]);
    expect(sessions.recent("U2", 10)).toEqual([{ role: "user", content: "punya U2" }]);
  });

  test("a failed reply saves nothing", async () => {
    const reply = mock(async () => {
      throw new Error("boom");
    });
    await handleEvents([textEvent("halo", "rt-1", USER_U1)], reply, sessions);
    expect(sessions.recent("U1", 10)).toEqual([]);
  });
});
