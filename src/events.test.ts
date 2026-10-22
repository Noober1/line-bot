import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { webhook } from "@line/bot-sdk";
import { handleEvents } from "./events";

function textEvent(text: string, replyToken?: string): webhook.Event {
  return {
    type: "message",
    replyToken,
    message: { type: "text", id: "m1", text, quoteToken: "q" },
  } as webhook.Event;
}

function okReply() {
  return mock(async (_replyToken: string, _text: string) => {});
}

describe("handleEvents", () => {
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    errorSpy.mockClear();
  });

  afterAll(() => {
    errorSpy.mockRestore();
  });

  test("echoes a text message using its reply token", async () => {
    const reply = okReply();
    await handleEvents([textEvent("hello", "rt-1")], reply);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith("rt-1", "hello");
  });

  test("echoes every text message in one batch", async () => {
    const reply = okReply();
    await handleEvents([textEvent("a", "rt-a"), textEvent("b", "rt-b")], reply);
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply).toHaveBeenCalledWith("rt-a", "a");
    expect(reply).toHaveBeenCalledWith("rt-b", "b");
  });

  test("ignores non-text messages", async () => {
    const reply = okReply();
    const sticker = {
      type: "message",
      replyToken: "rt-1",
      message: { type: "sticker", id: "m1", packageId: "1", stickerId: "1" },
    } as webhook.Event;
    await handleEvents([sticker], reply);
    expect(reply).not.toHaveBeenCalled();
  });

  test("ignores non-message events even with a reply token", async () => {
    const reply = okReply();
    const follow = { type: "follow", replyToken: "rt-1", follow: { isUnblocked: false } } as webhook.Event;
    await handleEvents([follow], reply);
    expect(reply).not.toHaveBeenCalled();
  });

  test("ignores text messages without a reply token", async () => {
    const reply = okReply();
    await handleEvents([textEvent("hello")], reply);
    expect(reply).not.toHaveBeenCalled();
  });

  test("a failed reply is logged and does not stop other replies", async () => {
    const reply = mock(async (replyToken: string, _text: string) => {
      if (replyToken === "rt-bad") throw new Error("boom");
    });
    await handleEvents([textEvent("x", "rt-bad"), textEvent("y", "rt-ok")], reply);
    expect(reply).toHaveBeenCalledWith("rt-ok", "y");
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test("never rejects when every reply fails", async () => {
    const reply = mock(async () => {
      throw new Error("boom");
    });
    await expect(handleEvents([textEvent("x", "rt-1")], reply)).resolves.toBeUndefined();
  });
});
