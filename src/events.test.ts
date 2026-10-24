import { Database } from "bun:sqlite";
import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { webhook } from "@line/bot-sdk";
import { translatePrompt } from "./commands";
import { AI_HISTORY_LIMIT, handleEvents, type Languages } from "./events";
import { createSessionStore, type SessionStore, type StoredMessage } from "./session";
import { createSettingsStore, type SettingsStore } from "./settings";

const USER_U1: webhook.Source = { type: "user", userId: "U1" };
const USER_U2: webhook.Source = { type: "user", userId: "U2" };
const ID_LANGUAGES: Languages = { lineLanguage: async () => undefined, defaultLocale: "id" };
const GROUP_C1: webhook.Source = { type: "group", groupId: "C1", userId: "U1" };
const ROOM_R1: webhook.Source = { type: "room", roomId: "R1", userId: "U1" };
// "@Elysia" (7 chars) at the start of the text, as LINE sends a mention of the bot.
const BOT_MENTION: webhook.Mention = { mentionees: [{ type: "user", index: 0, length: 7, userId: "Ubot", isSelf: true }] };
const ELYSIA_USAGE_ID = "Pakai: /elysia <pesan>. Di grup, bisa juga mention bot lalu tulis pesannya.";

function textEvent(text: string, replyToken?: string, source?: webhook.Source, mention?: webhook.Mention): webhook.Event {
  return {
    type: "message",
    replyToken,
    source,
    message: { type: "text", id: "m1", text, quoteToken: "q", mention },
  } as webhook.Event;
}

function okReply() {
  return mock(async (_replyToken: string, _text: string) => {});
}

// Answers "re: <text of the newest message>", so each test can tell which message was answered.
function echoAi() {
  return mock(async (messages: readonly StoredMessage[], _system?: string) => `re: ${messages.at(-1)?.content}`);
}

function failingAi() {
  return mock(async (_messages: readonly StoredMessage[], _system?: string): Promise<string> => {
    throw new Error("ai down");
  });
}

describe("handleEvents", () => {
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});
  let sessions: SessionStore;
  let settings: SettingsStore;

  beforeEach(() => {
    errorSpy.mockClear();
    const db = new Database(":memory:");
    sessions = createSessionStore(db);
    settings = createSettingsStore(db, { translate: "en" });
  });

  afterAll(() => {
    errorSpy.mockRestore();
  });

  test("answers a text message with the AI answer using its reply token", async () => {
    const reply = okReply();
    await handleEvents([textEvent("hello", "rt-1")], reply, sessions, echoAi(), settings);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith("rt-1", "re: hello");
  });

  test("answers every text message in one batch", async () => {
    const reply = okReply();
    await handleEvents([textEvent("a", "rt-a"), textEvent("b", "rt-b")], reply, sessions, echoAi(), settings);
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply).toHaveBeenCalledWith("rt-a", "re: a");
    expect(reply).toHaveBeenCalledWith("rt-b", "re: b");
  });

  test("replies to a command without calling the AI", async () => {
    const reply = okReply();
    const ai = echoAi();
    await handleEvents([textEvent("/ping", "rt-1")], reply, sessions, ai, settings);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith("rt-1", "pong");
    expect(ai).not.toHaveBeenCalled();
  });

  test("answers an unknown command with a friendly error", async () => {
    const reply = okReply();
    await handleEvents([textEvent("/foo", "rt-1")], reply, sessions, echoAi(), settings);
    expect(reply).toHaveBeenCalledWith(
      "rt-1",
      "Perintah /foo tidak dikenal. Ketik /help untuk daftar perintah.",
    );
  });

  test("ignores non-text messages", async () => {
    const reply = okReply();
    const ai = echoAi();
    const sticker = {
      type: "message",
      replyToken: "rt-1",
      message: { type: "sticker", id: "m1", packageId: "1", stickerId: "1" },
    } as webhook.Event;
    await handleEvents([sticker], reply, sessions, ai, settings);
    expect(reply).not.toHaveBeenCalled();
    expect(ai).not.toHaveBeenCalled();
  });

  test("ignores non-message events even with a reply token", async () => {
    const reply = okReply();
    const ai = echoAi();
    const follow = { type: "follow", replyToken: "rt-1", follow: { isUnblocked: false } } as webhook.Event;
    await handleEvents([follow], reply, sessions, ai, settings);
    expect(reply).not.toHaveBeenCalled();
    expect(ai).not.toHaveBeenCalled();
  });

  test("ignores text messages without a reply token", async () => {
    const reply = okReply();
    const ai = echoAi();
    await handleEvents([textEvent("hello")], reply, sessions, ai, settings);
    expect(reply).not.toHaveBeenCalled();
    expect(ai).not.toHaveBeenCalled();
  });

  test("a failed reply is logged and does not stop other replies", async () => {
    const reply = mock(async (replyToken: string, _text: string) => {
      if (replyToken === "rt-bad") throw new Error("boom");
    });
    await handleEvents([textEvent("x", "rt-bad"), textEvent("y", "rt-ok")], reply, sessions, echoAi(), settings);
    expect(reply).toHaveBeenCalledWith("rt-ok", "re: y");
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test("never rejects when every reply fails", async () => {
    const reply = mock(async () => {
      throw new Error("boom");
    });
    await expect(handleEvents([textEvent("x", "rt-1")], reply, sessions, echoAi(), settings)).resolves.toBeUndefined();
  });

  test("saves a text message and the AI answer to the sender's history", async () => {
    await handleEvents([textEvent("halo", "rt-1", USER_U1)], okReply(), sessions, echoAi(), settings);
    expect(sessions.recent("U1", 10)).toEqual([
      { role: "user", content: "halo" },
      { role: "assistant", content: "re: halo" },
    ]);
  });

  test("messages in a group go to the group's shared history", async () => {
    const events = [
      textEvent("@Elysia dari U1", "rt-1", { type: "group", groupId: "C1", userId: "U1" }, BOT_MENTION),
      textEvent("@Elysia dari U2", "rt-2", { type: "group", groupId: "C1", userId: "U2" }, BOT_MENTION),
    ];
    await handleEvents(events, okReply(), sessions, echoAi(), settings);
    expect(sessions.recent("C1", 10)).toHaveLength(4);
    expect(sessions.recent("U1", 10)).toEqual([]);
    expect(sessions.recent("U2", 10)).toEqual([]);
  });

  test("does not save commands", async () => {
    await handleEvents([textEvent("/ping", "rt-1", USER_U1)], okReply(), sessions, echoAi(), settings);
    expect(sessions.recent("U1", 10)).toEqual([]);
  });

  test("/reset clears only the current chat's history", async () => {
    sessions.append("U1", "user", "lama");
    sessions.append("U2", "user", "punya U2");
    const reply = okReply();
    await handleEvents([textEvent("/reset", "rt-1", USER_U1)], reply, sessions, echoAi(), settings);
    expect(reply).toHaveBeenCalledWith("rt-1", "Riwayat chat sudah dihapus.");
    expect(sessions.recent("U1", 10)).toEqual([]);
    expect(sessions.recent("U2", 10)).toEqual([{ role: "user", content: "punya U2" }]);
  });

  test("a failed reply saves nothing", async () => {
    const reply = mock(async () => {
      throw new Error("boom");
    });
    await handleEvents([textEvent("halo", "rt-1", USER_U1)], reply, sessions, echoAi(), settings);
    expect(sessions.recent("U1", 10)).toEqual([]);
  });

  test("sends the chat history plus the new message to the AI", async () => {
    sessions.append("U1", "user", "halo");
    sessions.append("U1", "assistant", "hai");
    sessions.append("U2", "user", "punya U2");
    const ai = echoAi();
    await handleEvents([textEvent("apa kabar?", "rt-1", USER_U1)], okReply(), sessions, ai, settings);
    expect(ai).toHaveBeenCalledWith([
      { role: "user", content: "halo" },
      { role: "assistant", content: "hai" },
      { role: "user", content: "apa kabar?" },
    ]);
  });

  test("sends only the newest AI_HISTORY_LIMIT stored messages", async () => {
    for (let i = 0; i < 30; i++) sessions.append("U1", "user", `m${i}`);
    const ai = echoAi();
    await handleEvents([textEvent("baru", "rt-1", USER_U1)], okReply(), sessions, ai, settings);
    const sent = ai.mock.calls[0]![0];
    expect(sent).toHaveLength(AI_HISTORY_LIMIT + 1);
    expect(sent[0]).toEqual({ role: "user", content: "m10" });
    expect(sent.at(-1)).toEqual({ role: "user", content: "baru" });
  });

  test("drops an assistant row at the start of the history window", async () => {
    // 21 rows alternating user/assistant: the newest 20 start with an assistant row.
    for (let i = 0; i <= AI_HISTORY_LIMIT; i++) {
      sessions.append("U1", i % 2 === 0 ? "user" : "assistant", `m${i}`);
    }
    const ai = echoAi();
    await handleEvents([textEvent("baru", "rt-1", USER_U1)], okReply(), sessions, ai, settings);
    const sent = ai.mock.calls[0]![0];
    expect(sent[0]).toEqual({ role: "user", content: "m2" });
    expect(sent).toHaveLength(AI_HISTORY_LIMIT);
  });

  test("the AI gets the group's shared history, whoever sends the new message", async () => {
    const group: webhook.Source = { type: "group", groupId: "C1", userId: "U1" };
    const ai = echoAi();
    await handleEvents([textEvent("@Elysia dari U1", "rt-1", group, BOT_MENTION)], okReply(), sessions, ai, settings);
    await handleEvents([textEvent("@Elysia dari U2", "rt-2", { ...group, userId: "U2" }, BOT_MENTION)], okReply(), sessions, ai, settings);
    expect(ai).toHaveBeenLastCalledWith([
      { role: "user", content: "dari U1" },
      { role: "assistant", content: "re: dari U1" },
      { role: "user", content: "dari U2" },
    ]);
  });

  test("group, other group, room and 1:1 histories never leak into each other", async () => {
    sessions.append("C1", "user", "rahasia grup 1");
    sessions.append("C2", "user", "rahasia grup 2");
    sessions.append("R1", "user", "rahasia room");
    sessions.append("U1", "user", "rahasia pribadi");
    const ai = echoAi();
    const events = [
      textEvent("@Elysia tanya", "rt", GROUP_C1, BOT_MENTION),
      textEvent("@Elysia tanya", "rt", ROOM_R1, BOT_MENTION),
      textEvent("tanya", "rt", USER_U1),
    ];
    await handleEvents(events, okReply(), sessions, ai, settings);
    const sent = ai.mock.calls.map(([messages]) => messages.map((message) => message.content));
    expect(sent).toContainEqual(["rahasia grup 1", "tanya"]);
    expect(sent).toContainEqual(["rahasia room", "tanya"]);
    expect(sent).toContainEqual(["rahasia pribadi", "tanya"]);
    expect(sent).toHaveLength(3);
  });

  test("a message without a usable source is answered without history", async () => {
    const reply = okReply();
    const ai = echoAi();
    await handleEvents([textEvent("halo", "rt-1")], reply, sessions, ai, settings);
    expect(ai).toHaveBeenCalledWith([{ role: "user", content: "halo" }]);
    expect(reply).toHaveBeenCalledWith("rt-1", "re: halo");
  });

  test("an AI failure is logged, sends no reply, saves nothing, and does not stop other events", async () => {
    const reply = okReply();
    const ai = mock(async (messages: readonly StoredMessage[]) => {
      if (messages.at(-1)?.content === "rusak") throw new Error("ai down");
      return "oke";
    });
    await handleEvents(
      [textEvent("rusak", "rt-bad", USER_U1), textEvent("sehat", "rt-ok", USER_U2)],
      reply,
      sessions,
      ai,
      settings,
    );
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith("rt-ok", "oke");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(sessions.recent("U1", 10)).toEqual([]);
  });

  test("never rejects when the AI fails", async () => {
    await expect(
      handleEvents([textEvent("x", "rt-1", USER_U1)], okReply(), sessions, failingAi(), settings),
    ).resolves.toBeUndefined();
  });

  test("/config in a 1:1 chat changes the sender's settings", async () => {
    const reply = okReply();
    await handleEvents([textEvent("/config translate ja", "rt-1", USER_U1)], reply, sessions, echoAi(), settings);
    expect(reply).toHaveBeenCalledWith("rt-1", "translate diubah ke ja.");
    expect(settings.stored("U1")).toEqual({ translate: "ja" });
  });

  test("/config in a group changes the sender's settings, not the group's", async () => {
    const group: webhook.Source = { type: "group", groupId: "C1", userId: "U1" };
    await handleEvents([textEvent("/config translate ja", "rt-1", group)], okReply(), sessions, echoAi(), settings);
    expect(settings.stored("U1")).toEqual({ translate: "ja" });
    expect(settings.stored("C1")).toEqual({});
    const reply = okReply();
    await handleEvents([textEvent("/config", "rt-2", USER_U1)], reply, sessions, echoAi(), settings);
    expect(reply.mock.calls[0]![1]).toContain("translate = ja - ");
  });

  test("/config from a group member without a user ID is refused", async () => {
    const reply = okReply();
    const group = { type: "group", groupId: "C1" } as webhook.Source;
    await handleEvents([textEvent("/config translate ja", "rt-1", group)], reply, sessions, echoAi(), settings);
    expect(reply).toHaveBeenCalledWith("rt-1", "Pengaturan tidak bisa dipakai: LINE tidak mengirim ID kamu.");
    expect(settings.stored("C1")).toEqual({});
  });

  test("/translate replies with the AI translation, without history, and saves nothing", async () => {
    sessions.append("U1", "user", "lama");
    sessions.append("U1", "assistant", "jawaban lama");
    const reply = okReply();
    const ai = echoAi();
    await handleEvents([textEvent("/translate halo", "rt-1", USER_U1)], reply, sessions, ai, settings);
    expect(reply).toHaveBeenCalledWith("rt-1", "re: halo");
    expect(ai).toHaveBeenCalledWith([{ role: "user", content: "halo" }], translatePrompt("en"));
    expect(sessions.recent("U1", 10)).toEqual([
      { role: "user", content: "lama" },
      { role: "assistant", content: "jawaban lama" },
    ]);
  });

  test("/translate in a group uses the sender's language", async () => {
    settings.set("U1", "translate", "ja");
    const ai = echoAi();
    const group: webhook.Source = { type: "group", groupId: "C1", userId: "U1" };
    await handleEvents([textEvent("/translate halo", "rt-1", group)], okReply(), sessions, ai, settings);
    expect(ai.mock.calls[0]![1]).toBe(translatePrompt("ja"));
  });

  test("/translate from a group member without a user ID uses the global default", async () => {
    const ai = echoAi();
    const group = { type: "group", groupId: "C1" } as webhook.Source;
    await handleEvents([textEvent("/translate halo", "rt-1", group)], okReply(), sessions, ai, settings);
    expect(ai.mock.calls[0]![1]).toBe(translatePrompt("en"));
  });

  test("/translate still replies when the AI fails", async () => {
    const reply = okReply();
    await handleEvents([textEvent("/translate halo", "rt-1", USER_U1)], reply, sessions, failingAi(), settings);
    expect(reply).toHaveBeenCalledWith("rt-1", "Gagal menerjemahkan. Coba lagi nanti.");
  });

  test("a command is answered in the sender's LINE language", async () => {
    const reply = okReply();
    const lineLanguage = mock(async (_userId: string) => "ja");
    await handleEvents([textEvent("/reset", "rt-1", USER_U1)], reply, sessions, echoAi(), settings, {
      lineLanguage,
      defaultLocale: "id",
    });
    expect(lineLanguage).toHaveBeenCalledWith("U1");
    expect(reply).toHaveBeenCalledWith("rt-1", "チャット履歴を削除しました。");
  });

  test("a group command uses the sender's LINE language", async () => {
    const reply = okReply();
    const lineLanguage = mock(async (_userId: string) => "zh-TW");
    const group: webhook.Source = { type: "group", groupId: "C1", userId: "U1" };
    await handleEvents([textEvent("/reset", "rt-1", group)], reply, sessions, echoAi(), settings, {
      lineLanguage,
      defaultLocale: "id",
    });
    expect(lineLanguage).toHaveBeenCalledWith("U1");
    expect(reply).toHaveBeenCalledWith("rt-1", "聊天記錄已清除。");
  });

  test("an unknown or unsupported LINE language falls back to the default locale", async () => {
    for (const language of [undefined, "ko"]) {
      const reply = okReply();
      await handleEvents([textEvent("/reset", "rt-1", USER_U1)], reply, sessions, echoAi(), settings, {
        lineLanguage: async () => language,
        defaultLocale: "en",
      });
      expect(reply).toHaveBeenCalledWith("rt-1", "Chat history cleared.");
    }
  });

  test("the LINE language is the default target of /translate", async () => {
    const ai = echoAi();
    await handleEvents([textEvent("/translate halo", "rt-1", USER_U1)], okReply(), sessions, ai, settings, {
      lineLanguage: async () => "ko-KR",
      defaultLocale: "id",
    });
    expect(ai.mock.calls[0]![1]).toBe(translatePrompt("ko"));
  });

  test("without a user ID the LINE language is not fetched", async () => {
    const reply = okReply();
    const lineLanguage = mock(async (_userId: string) => "ja");
    const group = { type: "group", groupId: "C1" } as webhook.Source;
    await handleEvents([textEvent("/reset", "rt-1", group)], reply, sessions, echoAi(), settings, {
      lineLanguage,
      defaultLocale: "en",
    });
    expect(lineLanguage).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith("rt-1", "Chat history cleared.");
  });

  test("AI chat does not fetch the LINE language", async () => {
    const lineLanguage = mock(async (_userId: string) => "ja");
    await handleEvents([textEvent("halo", "rt-1", USER_U1)], okReply(), sessions, echoAi(), settings, {
      lineLanguage,
      defaultLocale: "id",
    });
    expect(lineLanguage).not.toHaveBeenCalled();
  });

  test("over the rate limit the chat gets one notice, no AI call, nothing saved", async () => {
    const reply = okReply();
    const ai = echoAi();
    const rateLimit = mock((_key: string) => "notify" as const);
    await handleEvents([textEvent("halo", "rt-1", USER_U1)], reply, sessions, ai, settings, ID_LANGUAGES, rateLimit);
    expect(reply).toHaveBeenCalledWith("rt-1", "Pesannya terlalu banyak. Tunggu sebentar lalu coba lagi.");
    expect(ai).not.toHaveBeenCalled();
    expect(sessions.recent("U1", 10)).toEqual([]);
  });

  test("a dropped message gets no reply and no AI call", async () => {
    const reply = okReply();
    const ai = echoAi();
    await handleEvents([textEvent("/ping", "rt-1", USER_U1)], reply, sessions, ai, settings, ID_LANGUAGES, () => "drop");
    expect(reply).not.toHaveBeenCalled();
    expect(ai).not.toHaveBeenCalled();
  });

  test("the rate limit is per chat: a group message counts for the group", async () => {
    const rateLimit = mock((_key: string) => "allow" as const);
    const group: webhook.Source = { type: "group", groupId: "C1", userId: "U1" };
    await handleEvents([textEvent("/ping", "rt-1", group)], okReply(), sessions, echoAi(), settings, ID_LANGUAGES, rateLimit);
    expect(rateLimit).toHaveBeenCalledWith("C1");
  });

  test("non-text events do not count toward the rate limit", async () => {
    const rateLimit = mock((_key: string) => "allow" as const);
    const follow = { type: "follow", replyToken: "rt-1", follow: { isUnblocked: false } } as webhook.Event;
    await handleEvents([follow], okReply(), sessions, echoAi(), settings, ID_LANGUAGES, rateLimit);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  test("the rate-limit notice is in the sender's LINE language", async () => {
    const reply = okReply();
    await handleEvents([textEvent("halo", "rt-1", USER_U1)], reply, sessions, echoAi(), settings,
      { lineLanguage: async () => "ja", defaultLocale: "id" }, () => "notify");
    expect(reply).toHaveBeenCalledWith("rt-1", "メッセージが多すぎます。少し待ってからもう一度お試しください。");
  });

  test("in a group a message that mentions the bot goes to the AI without the mention, and is saved so", async () => {
    const reply = okReply();
    const ai = echoAi();
    await handleEvents([textEvent("@Elysia apa kabar?", "rt-1", GROUP_C1, BOT_MENTION)], reply, sessions, ai, settings);
    expect(ai).toHaveBeenCalledWith([{ role: "user", content: "apa kabar?" }]);
    expect(reply).toHaveBeenCalledWith("rt-1", "re: apa kabar?");
    expect(sessions.recent("C1", 10)).toEqual([
      { role: "user", content: "apa kabar?" },
      { role: "assistant", content: "re: apa kabar?" },
    ]);
  });

  test("a mention after an emoji is cut by UTF-16 index; other people's mentions stay", async () => {
    // "😀" is 2 UTF-16 code units, so "@Elysia" starts at 8; in the second text "@Budi" is at 0, "@Elysia" at 6.
    const ai = echoAi();
    const own: webhook.Mention = { mentionees: [{ type: "user", index: 8, length: 7, userId: "Ubot", isSelf: true }] };
    await handleEvents([textEvent("😀 halo @Elysia tolong", "rt-1", GROUP_C1, own)], okReply(), sessions, ai, settings);
    const mixed: webhook.Mention = { mentionees: [
      { type: "user", index: 0, length: 5, userId: "U2", isSelf: false },
      { type: "user", index: 6, length: 7, userId: "Ubot", isSelf: true },
    ] };
    await handleEvents([textEvent("@Budi @Elysia tanya dong", "rt-2", { type: "group", groupId: "C9", userId: "U1" }, mixed)], okReply(), sessions, ai, settings);
    expect(ai.mock.calls[0]![0].at(-1)).toEqual({ role: "user", content: "😀 halo  tolong" });
    expect(ai.mock.calls[1]![0].at(-1)).toEqual({ role: "user", content: "@Budi  tanya dong" });
  });

  test("a plain group or room message is ignored and does not count toward the rate limit", async () => {
    const reply = okReply();
    const ai = echoAi();
    const rateLimit = mock((_key: string) => "allow" as const);
    const events = [textEvent("halo semua", "rt-1", GROUP_C1), textEvent("halo semua", "rt-2", ROOM_R1)];
    await handleEvents(events, reply, sessions, ai, settings, ID_LANGUAGES, rateLimit);
    expect(reply).not.toHaveBeenCalled();
    expect(ai).not.toHaveBeenCalled();
    expect(rateLimit).not.toHaveBeenCalled();
    expect(sessions.recent("C1", 10)).toEqual([]);
  });

  test("a mention of someone else or @All is ignored", async () => {
    const reply = okReply();
    const ai = echoAi();
    const other: webhook.Mention = { mentionees: [{ type: "user", index: 0, length: 5, userId: "U2", isSelf: false }] };
    const all: webhook.Mention = { mentionees: [{ type: "all", index: 0, length: 4 }] };
    await handleEvents(
      [textEvent("@Budi halo", "rt-1", GROUP_C1, other), textEvent("@All rapat jam 3", "rt-2", GROUP_C1, all)],
      reply, sessions, ai, settings,
    );
    expect(reply).not.toHaveBeenCalled();
    expect(ai).not.toHaveBeenCalled();
  });

  test("a mention of the bot in a room is answered", async () => {
    const reply = okReply();
    await handleEvents([textEvent("@Elysia halo", "rt-1", ROOM_R1, BOT_MENTION)], reply, sessions, echoAi(), settings);
    expect(reply).toHaveBeenCalledWith("rt-1", "re: halo");
  });

  test("/elysia <text> in a group goes to the AI with the group's history and is saved", async () => {
    sessions.append("C1", "user", "lama");
    sessions.append("C1", "assistant", "jawaban lama");
    const ai = echoAi();
    const reply = okReply();
    await handleEvents([textEvent("/Elysia  apa kabar?", "rt-1", GROUP_C1)], reply, sessions, ai, settings);
    expect(ai).toHaveBeenCalledWith([
      { role: "user", content: "lama" },
      { role: "assistant", content: "jawaban lama" },
      { role: "user", content: "apa kabar?" },
    ]);
    expect(reply).toHaveBeenCalledWith("rt-1", "re: apa kabar?");
    expect(sessions.recent("C1", 10).at(-2)).toEqual({ role: "user", content: "apa kabar?" });
  });

  test("/elysia without text, or a bare mention of the bot, gets the usage message and no AI call", async () => {
    const reply = okReply();
    const ai = echoAi();
    await handleEvents(
      [textEvent("/elysia   ", "rt-1", GROUP_C1), textEvent("@Elysia ", "rt-2", GROUP_C1, BOT_MENTION)],
      reply, sessions, ai, settings,
    );
    expect(reply).toHaveBeenCalledWith("rt-1", ELYSIA_USAGE_ID);
    expect(reply).toHaveBeenCalledWith("rt-2", ELYSIA_USAGE_ID);
    expect(ai).not.toHaveBeenCalled();
    expect(sessions.recent("C1", 10)).toEqual([]);
  });

  test("the /elysia usage message is in the sender's LINE language", async () => {
    const reply = okReply();
    await handleEvents([textEvent("/elysia", "rt-1", GROUP_C1)], reply, sessions, echoAi(), settings,
      { lineLanguage: async () => "ja", defaultLocale: "id" });
    expect(reply).toHaveBeenCalledWith("rt-1", "使い方: /elysia <メッセージ>。グループではボットをメンションしてメッセージを書くこともできます。");
  });

  test("other commands still work in a group without a mention, /help lists /elysia", async () => {
    const reply = okReply();
    await handleEvents([textEvent("/ping", "rt-1", GROUP_C1), textEvent("/help", "rt-2", GROUP_C1)], reply, sessions, echoAi(), settings);
    expect(reply).toHaveBeenCalledWith("rt-1", "pong");
    expect(reply.mock.calls.find(([token]) => token === "rt-2")![1]).toContain("/elysia - ");
  });

  test("a 1:1 message still goes straight to the AI, mention data or not", async () => {
    const ai = echoAi();
    await handleEvents([textEvent("@Elysia halo", "rt-1", USER_U1, BOT_MENTION)], okReply(), sessions, ai, settings);
    expect(ai).toHaveBeenCalledWith([{ role: "user", content: "@Elysia halo" }]);
  });

  test("/elysia <text> in a 1:1 chat goes to the AI", async () => {
    const ai = echoAi();
    await handleEvents([textEvent("/elysia halo", "rt-1", USER_U1)], okReply(), sessions, ai, settings);
    expect(ai).toHaveBeenCalledWith([{ role: "user", content: "halo" }]);
  });
});
