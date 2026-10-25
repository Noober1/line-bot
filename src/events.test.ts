import { Database } from "bun:sqlite";
import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { webhook } from "@line/bot-sdk";
import type { Access } from "./access-commands";
import { filterDms } from "./allowlist";
import { createAutoTranslateStore, type AutoTranslateStore } from "./auto-translate";
import { autoTranslatePrompt, translatePrompt } from "./commands";
import { createDedupe } from "./dedupe";
import { AI_HISTORY_LIMIT, handleEvents as handle, NOT_PERMITTED_NOTICE_MS, type Languages } from "./events";
import { createGroupStore, type GroupStore } from "./groups";
import type { RateLimit } from "./ratelimit";
import { MESSAGES } from "./messages";
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

// U1 is the owner (see the Access in the tests below), C1 and C9 are allowed groups.
function textEvent(
  text: string,
  replyToken?: string,
  source: webhook.Source | undefined = USER_U1,
  mention?: webhook.Mention,
): webhook.Event {
  return {
    type: "message",
    replyToken,
    source,
    message: { type: "text", id: "m1", text, quoteToken: "q", mention },
  } as webhook.Event;
}

function okReply() {
  return mock(async (_replyToken: string, _text: string, _quoteToken?: string) => {});
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
  let groups: GroupStore;
  let access: Access;
  let autoTranslate: AutoTranslateStore;
  let clock = 0;

  beforeEach(() => {
    errorSpy.mockClear();
    clock = 0;
    const db = new Database(":memory:");
    sessions = createSessionStore(db);
    settings = createSettingsStore(db, { translate: "en" });
    groups = createGroupStore(db, () => clock);
    autoTranslate = createAutoTranslateStore(db);
    access = {
      groups,
      groupSettings: createSettingsStore(db, { translate: "en" }, "group_settings"),
      ownerUserId: "U1",
      maxGroupsPerUser: 3,
      groupName: async (groupId) => `nama ${groupId}`,
    };
    // C1 and C9 are allowed, with U7 as admin.
    for (const groupId of ["C1", "C9"]) groups.approve(groups.request(groupId, "U7").id);
  });

  function handleEvents(
    events: webhook.Event[],
    reply: Parameters<typeof handle>[1],
    sessionStore: SessionStore,
    ai: Parameters<typeof handle>[3],
    settingsStore: SettingsStore,
    languages: Languages = ID_LANGUAGES,
    rateLimit: RateLimit = () => "allow",
  ) {
    return handle(events, reply, sessionStore, ai, settingsStore, languages, rateLimit, access, autoTranslate);
  }

  afterAll(() => {
    errorSpy.mockRestore();
  });

  test("answers a text message with the AI answer using its reply token", async () => {
    const reply = okReply();
    await handleEvents([textEvent("hello", "rt-1")], reply, sessions, echoAi(), settings);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith("rt-1", "re: hello", "q");
  });

  test("answers every text message in one batch", async () => {
    const reply = okReply();
    await handleEvents([textEvent("a", "rt-a"), textEvent("b", "rt-b")], reply, sessions, echoAi(), settings);
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply).toHaveBeenCalledWith("rt-a", "re: a", "q");
    expect(reply).toHaveBeenCalledWith("rt-b", "re: b", "q");
  });

  test("replies to a command without calling the AI", async () => {
    const reply = okReply();
    const ai = echoAi();
    await handleEvents([textEvent("/ping", "rt-1")], reply, sessions, ai, settings);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith("rt-1", "pong", "q");
    expect(ai).not.toHaveBeenCalled();
  });

  test("answers an unknown command with a friendly error", async () => {
    const reply = okReply();
    await handleEvents([textEvent("/foo", "rt-1")], reply, sessions, echoAi(), settings);
    expect(reply).toHaveBeenCalledWith(
      "rt-1",
      "Perintah /foo tidak dikenal. Ketik /help untuk daftar perintah.",
      "q",
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

  test("a text message without a quote token still gets an unquoted reply", async () => {
    const reply = okReply();
    const event = { type: "message", replyToken: "rt-1", source: USER_U1, message: { type: "text", id: "m1", text: "hello" } } as webhook.Event;
    await handleEvents([event], reply, sessions, echoAi(), settings);
    expect(reply).toHaveBeenCalledWith("rt-1", "re: hello", undefined);
  });

  test("a failed reply is logged and does not stop other replies", async () => {
    const reply = mock(async (replyToken: string, _text: string) => {
      if (replyToken === "rt-bad") throw new Error("boom");
    });
    await handleEvents([textEvent("x", "rt-bad"), textEvent("y", "rt-ok")], reply, sessions, echoAi(), settings);
    expect(reply).toHaveBeenCalledWith("rt-ok", "re: y", "q");
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
    expect(reply).toHaveBeenCalledWith("rt-1", "Riwayat chat sudah dihapus.", "q");
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

  test("group, other group and 1:1 histories never leak into each other; a room is ignored", async () => {
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
    expect(sent).toContainEqual(["rahasia pribadi", "tanya"]);
    expect(sent).toHaveLength(2);
  });

  test("an event without a source, or a 1:1 source without user ID, is ignored", async () => {
    const reply = okReply();
    const ai = echoAi();
    const noUser = { type: "user" } as webhook.Source;
    const noSource = { type: "message", replyToken: "rt-1", message: { type: "text", id: "m1", text: "halo", quoteToken: "q" } } as webhook.Event;
    await handleEvents([noSource, textEvent("halo", "rt-2", noUser)], reply, sessions, ai, settings);
    expect(reply).not.toHaveBeenCalled();
    expect(ai).not.toHaveBeenCalled();
  });

  test("an AI failure is logged, sends no reply, saves nothing, and does not stop other events", async () => {
    const reply = okReply();
    const ai = mock(async (messages: readonly StoredMessage[]) => {
      if (messages.at(-1)?.content === "rusak") throw new Error("ai down");
      return "oke";
    });
    await handleEvents(
      [
        textEvent("rusak", "rt-bad", USER_U1),
        textEvent("@Elysia sehat", "rt-ok", { type: "group", groupId: "C1", userId: "U2" }, BOT_MENTION),
      ],
      reply,
      sessions,
      ai,
      settings,
    );
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith("rt-ok", "oke", "q");
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
    expect(reply).toHaveBeenCalledWith("rt-1", "translate diubah ke ja.", "q");
    expect(settings.stored("U1")).toEqual({ translate: "ja" });
  });

  const CONFIG_IN_GROUP_ID = MESSAGES.id.configInGroup;

  test("/config in a group is refused with the DM hint, settings are neither read nor changed", async () => {
    settings.set("U1", "translate", "ja");
    const reply = okReply();
    const ai = echoAi();
    await handleEvents(
      [textEvent("/config translate ko", "rt-1", GROUP_C1), textEvent("/config", "rt-2", GROUP_C1)],
      reply, sessions, ai, settings,
    );
    expect(reply).toHaveBeenCalledWith("rt-1", CONFIG_IN_GROUP_ID, "q");
    expect(reply).toHaveBeenCalledWith("rt-2", CONFIG_IN_GROUP_ID, "q");
    expect(settings.stored("U1")).toEqual({ translate: "ja" });
    expect(settings.stored("C1")).toEqual({});
    expect(ai).not.toHaveBeenCalled();
  });

  test("/config from a group member without a user ID is refused the same way", async () => {
    const reply = okReply();
    const noId = { type: "group", groupId: "C1" } as webhook.Source;
    await handleEvents([textEvent("/config translate ja", "rt-2", noId)], reply, sessions, echoAi(), settings);
    expect(reply).toHaveBeenCalledWith("rt-2", CONFIG_IN_GROUP_ID, "q");
    expect(settings.stored("U1")).toEqual({});
  });

  test("the /config refusal in a group is in the sender's LINE language", async () => {
    const reply = okReply();
    await handleEvents([textEvent("/config", "rt-1", GROUP_C1)], reply, sessions, echoAi(), settings, {
      lineLanguage: async () => "ja",
      defaultLocale: "id",
    });
    expect(reply).toHaveBeenCalledWith("rt-1", MESSAGES.ja.configInGroup, "q");
  });

  test("/config in a 1:1 chat still lists settings", async () => {
    settings.set("U1", "translate", "ja");
    const reply = okReply();
    await handleEvents([textEvent("/config", "rt-1", USER_U1)], reply, sessions, echoAi(), settings);
    expect(reply.mock.calls[0]![1]).toContain("translate = ja - ");
  });

  test("/translate replies with the AI translation, without history, and saves nothing", async () => {
    sessions.append("U1", "user", "lama");
    sessions.append("U1", "assistant", "jawaban lama");
    const reply = okReply();
    const ai = echoAi();
    await handleEvents([textEvent("/translate halo", "rt-1", USER_U1)], reply, sessions, ai, settings);
    expect(reply).toHaveBeenCalledWith("rt-1", "re: halo", "q");
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
    expect(reply).toHaveBeenCalledWith("rt-1", "Gagal menerjemahkan. Coba lagi nanti.", "q");
  });

  test("a command is answered in the sender's LINE language", async () => {
    const reply = okReply();
    const lineLanguage = mock(async (_userId: string) => "ja");
    await handleEvents([textEvent("/reset", "rt-1", USER_U1)], reply, sessions, echoAi(), settings, {
      lineLanguage,
      defaultLocale: "id",
    });
    expect(lineLanguage).toHaveBeenCalledWith("U1");
    expect(reply).toHaveBeenCalledWith("rt-1", "チャット履歴を削除しました。", "q");
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
    expect(reply).toHaveBeenCalledWith("rt-1", "聊天記錄已清除。", "q");
  });

  test("an unknown or unsupported LINE language falls back to the default locale", async () => {
    for (const language of [undefined, "ko"]) {
      const reply = okReply();
      await handleEvents([textEvent("/reset", "rt-1", USER_U1)], reply, sessions, echoAi(), settings, {
        lineLanguage: async () => language,
        defaultLocale: "en",
      });
      expect(reply).toHaveBeenCalledWith("rt-1", "Chat history cleared.", "q");
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
    expect(reply).toHaveBeenCalledWith("rt-1", "Chat history cleared.", "q");
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
    expect(reply).toHaveBeenCalledWith("rt-1", "Pesannya terlalu banyak. Tunggu sebentar lalu coba lagi.", "q");
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
    expect(reply).toHaveBeenCalledWith("rt-1", "メッセージが多すぎます。少し待ってからもう一度お試しください。", "q");
  });

  test("in a group a message that mentions the bot goes to the AI without the mention, and is saved so", async () => {
    const reply = okReply();
    const ai = echoAi();
    await handleEvents([textEvent("@Elysia apa kabar?", "rt-1", GROUP_C1, BOT_MENTION)], reply, sessions, ai, settings);
    expect(ai).toHaveBeenCalledWith([{ role: "user", content: "apa kabar?" }]);
    expect(reply).toHaveBeenCalledWith("rt-1", "re: apa kabar?", "q");
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

  test("a room message is ignored, even a mention of the bot", async () => {
    const reply = okReply();
    await handleEvents([textEvent("@Elysia halo", "rt-1", ROOM_R1, BOT_MENTION)], reply, sessions, echoAi(), settings);
    expect(reply).not.toHaveBeenCalled();
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
    expect(reply).toHaveBeenCalledWith("rt-1", "re: apa kabar?", "q");
    expect(sessions.recent("C1", 10).at(-2)).toEqual({ role: "user", content: "apa kabar?" });
  });

  test("/elysia without text, or a bare mention of the bot, gets the usage message and no AI call", async () => {
    const reply = okReply();
    const ai = echoAi();
    await handleEvents(
      [textEvent("/elysia   ", "rt-1", GROUP_C1), textEvent("@Elysia ", "rt-2", GROUP_C1, BOT_MENTION)],
      reply, sessions, ai, settings,
    );
    expect(reply).toHaveBeenCalledWith("rt-1", ELYSIA_USAGE_ID, "q");
    expect(reply).toHaveBeenCalledWith("rt-2", ELYSIA_USAGE_ID, "q");
    expect(ai).not.toHaveBeenCalled();
    expect(sessions.recent("C1", 10)).toEqual([]);
  });

  test("the /elysia usage message is in the sender's LINE language", async () => {
    const reply = okReply();
    await handleEvents([textEvent("/elysia", "rt-1", GROUP_C1)], reply, sessions, echoAi(), settings,
      { lineLanguage: async () => "ja", defaultLocale: "id" });
    expect(reply).toHaveBeenCalledWith("rt-1", "使い方: /elysia <メッセージ>。グループではボットをメンションしてメッセージを書くこともできます。", "q");
  });

  test("other commands still work in a group without a mention, /help lists /elysia", async () => {
    const reply = okReply();
    await handleEvents([textEvent("/ping", "rt-1", GROUP_C1), textEvent("/help", "rt-2", GROUP_C1)], reply, sessions, echoAi(), settings);
    expect(reply).toHaveBeenCalledWith("rt-1", "pong", "q");
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

  describe("group access", () => {
    const EN: Languages = { lineLanguage: async () => undefined, defaultLocale: "en" };
    const inGroup = (groupId: string, userId?: string) => ({ type: "group", groupId, userId }) as webhook.Source;
    const mention = (text: string, token: string, groupId: string, userId?: string) =>
      textEvent(`@Elysia ${text}`, token, inGroup(groupId, userId), BOT_MENTION);
    const joinEvent = (groupId: string, token = "rt-join") =>
      ({ type: "join", replyToken: token, source: { type: "group", groupId } }) as webhook.Event;
    const leaveEvent = (groupId: string) => ({ type: "leave", source: { type: "group", groupId } }) as webhook.Event;
    const dm = (text: string, userId: string) => textEvent(text, "rt-dm", { type: "user", userId });
    const T = MESSAGES.id;

    test("join in a new group creates a pending group and replies with the join notice in the default language", async () => {
      const reply = okReply();
      await handleEvents([joinEvent("C5")], reply, sessions, echoAi(), settings, EN);
      expect(groups.get("C5")).toMatchObject({ status: "pending", requesterId: null });
      expect(reply).toHaveBeenCalledWith("rt-join", MESSAGES.en.joinNotice);
      expect(reply.mock.calls[0]![2]).toBeUndefined();
    });

    test("join in a denied group is silent and the group stays denied", async () => {
      groups.setStatus(groups.join("C5").id, "denied");
      const reply = okReply();
      await handleEvents([joinEvent("C5")], reply, sessions, echoAi(), settings);
      expect(reply).not.toHaveBeenCalled();
      expect(groups.get("C5")?.status).toBe("denied");
    });

    test("join in an allowed group resets it to pending", async () => {
      await handleEvents([joinEvent("C1")], okReply(), sessions, echoAi(), settings);
      expect(groups.get("C1")).toMatchObject({ status: "pending", requesterId: null });
    });

    test("a mention in a pending group records the first requester and answers not-permitted", async () => {
      groups.join("C5");
      const reply = okReply();
      const ai = echoAi();
      await handleEvents([mention("halo", "rt-1", "C5", "U2")], reply, sessions, ai, settings);
      const { id } = groups.get("C5")!;
      expect(reply).toHaveBeenCalledWith("rt-1", T.notPermitted(id), "q");
      expect(groups.get("C5")?.requesterId).toBe("U2");
      expect(ai).not.toHaveBeenCalled();
      clock += NOT_PERMITTED_NOTICE_MS + 1;
      await handleEvents([mention("halo", "rt-2", "C5", "U3")], reply, sessions, ai, settings);
      expect(reply).toHaveBeenCalledWith("rt-2", T.notPermitted(id), "q");
      expect(groups.get("C5")?.requesterId).toBe("U2");
    });

    test("the not-permitted notice is throttled per group", async () => {
      groups.join("C5");
      const reply = okReply();
      await handleEvents([mention("a", "rt-1", "C5", "U2")], reply, sessions, echoAi(), settings);
      clock += NOT_PERMITTED_NOTICE_MS / 2;
      await handleEvents([mention("b", "rt-2", "C5", "U2")], reply, sessions, echoAi(), settings);
      expect(reply).toHaveBeenCalledTimes(1);
      clock += NOT_PERMITTED_NOTICE_MS / 2;
      await handleEvents([mention("c", "rt-3", "C5", "U2")], reply, sessions, echoAi(), settings);
      expect(reply).toHaveBeenCalledTimes(2);
    });

    test("a member without a user ID gets unknown-sender; the next user becomes requester", async () => {
      const reply = okReply();
      await handleEvents([mention("halo", "rt-1", "C5")], reply, sessions, echoAi(), settings);
      expect(reply).toHaveBeenCalledWith("rt-1", T.unknownSender, "q");
      expect(groups.get("C5")?.requesterId).toBeNull();
      clock += NOT_PERMITTED_NOTICE_MS + 1;
      await handleEvents([mention("halo", "rt-2", "C5", "U3")], reply, sessions, echoAi(), settings);
      expect(groups.get("C5")?.requesterId).toBe("U3");
    });

    test("a plain message in an unknown group creates nothing and gets no reply", async () => {
      const reply = okReply();
      await handleEvents([textEvent("halo semua", "rt-1", inGroup("C5", "U2"))], reply, sessions, echoAi(), settings);
      expect(reply).not.toHaveBeenCalled();
      expect(groups.get("C5")).toBeNull();
    });

    test("a denied group is silent for members and does not use the rate limit; the owner still gets through", async () => {
      groups.setStatus(groups.request("C5", "U2").id, "denied");
      const reply = okReply();
      const ai = echoAi();
      const rateLimit = mock((_key: string) => "allow" as const);
      await handleEvents(
        [mention("halo", "rt-1", "C5", "U2"), textEvent("/ping", "rt-2", inGroup("C5", "U2"))],
        reply, sessions, ai, settings, ID_LANGUAGES, rateLimit,
      );
      expect(reply).not.toHaveBeenCalled();
      expect(rateLimit).not.toHaveBeenCalled();
      await handleEvents([mention("halo", "rt-3", "C5", "U1")], reply, sessions, ai, settings);
      expect(reply).toHaveBeenCalledWith("rt-3", "re: halo", "q");
    });

    test("any member of an allowed group is answered", async () => {
      const reply = okReply();
      await handleEvents([mention("halo", "rt-1", "C1", "U5")], reply, sessions, echoAi(), settings);
      expect(reply).toHaveBeenCalledWith("rt-1", "re: halo", "q");
    });

    test("the owner talking in a pending group allows it and becomes its admin", async () => {
      groups.request("C5", "U2");
      const reply = okReply();
      await handleEvents([mention("halo", "rt-1", "C5", "U1")], reply, sessions, echoAi(), settings);
      expect(reply).toHaveBeenCalledWith("rt-1", "re: halo", "q");
      expect(groups.get("C5")).toMatchObject({ status: "allowed", requesterId: "U1", adminId: "U1" });
    });

    test("a group the owner spoke in first cannot be taken over by another member", async () => {
      await handleEvents([mention("halo", "rt-1", "C5", "U1")], okReply(), sessions, echoAi(), settings);
      const reply = okReply();
      await handleEvents([mention("halo", "rt-2", "C5", "U2")], reply, sessions, echoAi(), settings);
      expect(groups.get("C5")).toMatchObject({ status: "allowed", requesterId: "U1", adminId: "U1" });
      expect(reply).toHaveBeenCalledWith("rt-2", "re: halo", "q");
    });

    test("the owner does not take over another admin's allowed group or a denied one", async () => {
      groups.setStatus(groups.request("C5", "U2").id, "denied");
      await handleEvents([mention("halo", "rt-1", "C1", "U1"), mention("halo", "rt-2", "C5", "U1")], okReply(), sessions, echoAi(), settings);
      expect(groups.get("C1")).toMatchObject({ status: "allowed", adminId: "U7" });
      expect(groups.get("C5")).toMatchObject({ status: "denied", adminId: null });
    });

    test("the access check runs before the rate limit", async () => {
      groups.join("C5");
      const rateLimit = mock((_key: string) => "allow" as const);
      await handleEvents([mention("halo", "rt-1", "C5", "U2")], okReply(), sessions, echoAi(), settings, ID_LANGUAGES, rateLimit);
      expect(rateLimit).not.toHaveBeenCalled();
    });

    test("leave marks the group left; joining again makes it pending and keeps the group settings", async () => {
      access.groupSettings.set("C1", "translate", "ja");
      await handleEvents([leaveEvent("C1")], okReply(), sessions, echoAi(), settings);
      expect(groups.get("C1")?.status).toBe("left");
      await handleEvents([joinEvent("C1")], okReply(), sessions, echoAi(), settings);
      expect(groups.get("C1")).toMatchObject({ status: "pending", requesterId: null });
      expect(access.groupSettings.stored("C1")).toEqual({ translate: "ja" });
    });

    test("a room join or mention is ignored and creates nothing", async () => {
      const reply = okReply();
      const roomJoin = { type: "join", replyToken: "rt-1", source: { type: "room", roomId: "R5" } } as webhook.Event;
      await handleEvents([roomJoin, textEvent("@Elysia halo", "rt-2", ROOM_R1, BOT_MENTION)], reply, sessions, echoAi(), settings);
      expect(reply).not.toHaveBeenCalled();
      expect(groups.list().map((group) => group.groupId)).toEqual(["C1", "C9"]);
    });

    test("the owner can chat with the AI and list groups in a DM", async () => {
      const reply = okReply();
      await handleEvents([dm("halo", "U1"), dm("/groups", "U1")], reply, sessions, echoAi(), settings);
      expect(reply.mock.calls[0]![1]).toBe("re: halo");
      expect(reply.mock.calls[1]![1]).toContain(T.groupsTitle);
    });

    test("a non-owner in a DM gets the groups-only text instead of the AI or other commands", async () => {
      const reply = okReply();
      const ai = echoAi();
      for (const text of ["halo", "/translate x", "/reset", "/elysia hi", "/admin 1 reset"]) {
        await handleEvents([dm(text, "U2")], reply, sessions, ai, settings);
      }
      expect(reply.mock.calls.map(([, text]) => text)).toEqual(Array(5).fill(T.dmGroupsOnly));
      expect(reply.mock.calls.every(([, , quote]) => quote === "q")).toBe(true);
      expect(ai).not.toHaveBeenCalled();
    });

    test("a non-owner in a DM may use /ping, /help, /groups and /config", async () => {
      const reply = okReply();
      for (const text of ["/ping", "/groups", "/config translate ko"]) {
        await handleEvents([dm(text, "U2")], reply, sessions, echoAi(), settings);
      }
      expect(reply.mock.calls.map(([, text]) => text)).toEqual(["pong", T.groupsEmpty, T.settingChanged("translate", "ko")]);
      expect(reply.mock.calls.every(([, , quote]) => quote === "q")).toBe(true);
      expect(settings.stored("U2")).toEqual({ translate: "ko" });
    });

    test("access commands other than /groupconfig are unknown commands in a group", async () => {
      const reply = okReply();
      await handleEvents([textEvent("/groups", "rt-1", inGroup("C1", "U7")), textEvent("/approve 1", "rt-2", inGroup("C1", "U7"))], reply, sessions, echoAi(), settings);
      expect(reply).toHaveBeenCalledWith("rt-1", T.unknownCommand("groups"), "q");
      expect(reply).toHaveBeenCalledWith("rt-2", T.unknownCommand("approve"), "q");
    });

    test("/groupconfig in a group is for the admin only", async () => {
      const reply = okReply();
      await handleEvents(
        [textEvent("/groupconfig translate ko", "rt-1", inGroup("C1", "U7")), textEvent("/groupconfig translate fr", "rt-2", inGroup("C1", "U5"))],
        reply, sessions, echoAi(), settings,
      );
      expect(reply).toHaveBeenCalledWith("rt-1", T.settingChanged("translate", "ko"), "q");
      expect(reply).toHaveBeenCalledWith("rt-2", T.groupConfigNotAdmin, "q");
      expect(access.groupSettings.stored("C1")).toEqual({ translate: "ko" });
    });

    test("/translate in a group: the user's value beats the group's, which beats the LINE language and the default", async () => {
      access.groupSettings.set("C1", "translate", "ko");
      const run = async (userId: string | undefined, lineLanguage?: string) => {
        const ai = echoAi();
        await handleEvents([textEvent("/translate halo", "rt-1", inGroup("C1", userId))], okReply(), sessions, ai, settings, {
          lineLanguage: async () => lineLanguage,
          defaultLocale: "id",
        });
        return ai.mock.calls[0]![1];
      };
      expect(await run("U5", "ja-JP")).toBe(translatePrompt("ko"));
      expect(await run(undefined)).toBe(translatePrompt("ko"));
      settings.set("U5", "translate", "fr");
      expect(await run("U5", "ja-JP")).toBe(translatePrompt("fr"));
      access.groupSettings.unset("C1", "translate");
      settings.unset("U5", "translate");
      expect(await run("U5", "ja-JP")).toBe(translatePrompt("ja"));
    });

    test("a redelivered event does not record or reply twice", async () => {
      groups.join("C5");
      const dedupe = createDedupe(new Database(":memory:"));
      const event = { ...mention("halo", "rt-1", "C5", "U2"), webhookEventId: "e1" } as webhook.Event;
      const reply = okReply();
      await handleEvents(dedupe(filterDms([event])), reply, sessions, echoAi(), settings);
      await handleEvents(dedupe(filterDms([event])), reply, sessions, echoAi(), settings);
      expect(reply).toHaveBeenCalledTimes(1);
    });

    describe("auto-translate", () => {
      const noopAi = () => mock(async (_m: readonly StoredMessage[], _s?: string) => "NOOP");
      const plain = (text: string, token: string, groupId: string, userId?: string) =>
        textEvent(text, token, inGroup(groupId, userId));

      test("/auto-translate toggles the switch for the sender in that group only", async () => {
        const reply = okReply();
        await handleEvents([textEvent("/auto-translate", "rt-1", inGroup("C1", "U5"))], reply, sessions, echoAi(), settings);
        expect(reply).toHaveBeenCalledWith("rt-1", T.autoTranslateOn("en"), "q");
        expect(autoTranslate.isOn("C1", "U5")).toBe(true);
        expect(autoTranslate.isOn("C1", "U6")).toBe(false);
        expect(autoTranslate.isOn("C9", "U5")).toBe(false);
        await handleEvents([textEvent("/auto-translate", "rt-2", inGroup("C1", "U5"))], reply, sessions, echoAi(), settings);
        expect(reply).toHaveBeenCalledWith("rt-2", T.autoTranslateOff, "q");
        expect(autoTranslate.isOn("C1", "U5")).toBe(false);
      });

      test("a plain message of a sender who is on is translated, quoted, and not saved", async () => {
        autoTranslate.toggle("C1", "U5");
        const reply = okReply();
        const ai = echoAi();
        await handleEvents([plain("selamat pagi", "rt-1", "C1", "U5")], reply, sessions, ai, settings);
        expect(ai).toHaveBeenCalledWith([{ role: "user", content: "selamat pagi" }], autoTranslatePrompt("en"));
        expect(reply).toHaveBeenCalledWith("rt-1", "re: selamat pagi", "q");
        expect(sessions.recent("C1", 10)).toEqual([]);
      });

      test("other members, and the same user in another group, are not translated", async () => {
        autoTranslate.toggle("C1", "U5");
        const reply = okReply();
        const ai = echoAi();
        await handleEvents([plain("halo", "rt-1", "C1", "U6"), plain("halo", "rt-2", "C9", "U5")], reply, sessions, ai, settings);
        expect(reply).not.toHaveBeenCalled();
        expect(ai).not.toHaveBeenCalled();
      });

      test("NOOP from the AI sends nothing and saves nothing", async () => {
        autoTranslate.toggle("C1", "U5");
        const reply = okReply();
        const logSpy = spyOn(console, "log").mockImplementation(() => {});
        await handleEvents([plain("good morning", "rt-1", "C1", "U5")], reply, sessions, noopAi(), settings);
        expect(reply).not.toHaveBeenCalled();
        expect(sessions.recent("C1", 10)).toEqual([]);
        expect(logSpy).toHaveBeenCalledWith("Auto-translate skipped in C1: the AI answered NOOP");
        logSpy.mockRestore();
      });

      test("commands and mentions of a sender who is on take their usual path", async () => {
        autoTranslate.toggle("C1", "U5");
        const reply = okReply();
        const ai = echoAi();
        await handleEvents([textEvent("/ping", "rt-1", inGroup("C1", "U5")), mention("apa kabar?", "rt-2", "C1", "U5")], reply, sessions, ai, settings);
        expect(reply).toHaveBeenCalledWith("rt-1", "pong", "q");
        expect(ai).toHaveBeenCalledTimes(1);
        expect(ai.mock.calls[0]![1]).toBeUndefined();
        expect(sessions.recent("C1", 10)).toEqual([
          { role: "user", content: "apa kabar?" },
          { role: "assistant", content: "re: apa kabar?" },
        ]);
      });

      test("a group that is not allowed refuses /auto-translate and stays silent for a sender who is on", async () => {
        const group = groups.join("C5");
        const reply = okReply();
        await handleEvents([textEvent("/auto-translate", "rt-1", inGroup("C5", "U5"))], reply, sessions, echoAi(), settings);
        expect(reply).toHaveBeenCalledWith("rt-1", T.notPermitted(group.id), "q");
        expect(autoTranslate.isOn("C5", "U5")).toBe(false);
        autoTranslate.toggle("C5", "U6");
        clock += NOT_PERMITTED_NOTICE_MS;
        const ai = echoAi();
        await handleEvents([plain("halo", "rt-2", "C5", "U6")], reply, sessions, ai, settings);
        expect(reply).toHaveBeenCalledTimes(1);
        expect(ai).not.toHaveBeenCalled();
      });

      test("/auto-translate in a DM is refused, for the owner too", async () => {
        const reply = okReply();
        await handleEvents([dm("/auto-translate", "U5"), textEvent("/auto-translate", "rt-own", USER_U1)], reply, sessions, echoAi(), settings);
        expect(reply).toHaveBeenCalledWith("rt-dm", T.autoTranslateGroupOnly, "q");
        expect(reply).toHaveBeenCalledWith("rt-own", T.autoTranslateGroupOnly, "q");
      });

      test("over the group rate limit a translation is dropped silently", async () => {
        autoTranslate.toggle("C1", "U5");
        const reply = okReply();
        const ai = echoAi();
        const rateLimit = mock((_key: string) => "notify" as const);
        await handleEvents([plain("halo", "rt-1", "C1", "U5")], reply, sessions, ai, settings, ID_LANGUAGES, rateLimit);
        expect(rateLimit).toHaveBeenCalledWith("C1");
        expect(reply).not.toHaveBeenCalled();
        expect(ai).not.toHaveBeenCalled();
      });

      test("an AI failure is logged and gets no reply", async () => {
        autoTranslate.toggle("C1", "U5");
        const reply = okReply();
        await handleEvents([plain("halo", "rt-1", "C1", "U5")], reply, sessions, failingAi(), settings);
        expect(reply).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalled();
      });

      test("a redelivered message is translated once", async () => {
        autoTranslate.toggle("C1", "U5");
        const dedupe = createDedupe(new Database(":memory:"));
        const event = { ...plain("halo", "rt-1", "C1", "U5"), webhookEventId: "e9" } as webhook.Event;
        const reply = okReply();
        await handleEvents(dedupe(filterDms([event])), reply, sessions, echoAi(), settings);
        await handleEvents(dedupe(filterDms([event])), reply, sessions, echoAi(), settings);
        expect(reply).toHaveBeenCalledTimes(1);
      });

      test("the target language follows the /translate resolution", async () => {
        autoTranslate.toggle("C1", "U5");
        const run = async (lineLanguage?: string) => {
          const ai = echoAi();
          await handleEvents([plain("halo", "rt-1", "C1", "U5")], okReply(), sessions, ai, settings, {
            lineLanguage: async () => lineLanguage,
            defaultLocale: "id",
          });
          return ai.mock.calls[0]![1];
        };
        expect(await run()).toBe(autoTranslatePrompt("en"));
        expect(await run("ja-JP")).toBe(autoTranslatePrompt("ja"));
        access.groupSettings.set("C1", "translate", "ko");
        expect(await run("ja-JP")).toBe(autoTranslatePrompt("ko"));
        settings.set("U5", "translate", "fr");
        expect(await run("ja-JP")).toBe(autoTranslatePrompt("fr"));
      });
    });
  });
});
