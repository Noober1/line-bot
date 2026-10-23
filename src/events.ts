import type { webhook } from "@line/bot-sdk";
import type { Ai } from "./ai";
import { parseCommand, runCommand } from "./commands";
import { sourceKey, type SessionStore, type StoredMessage } from "./session";
import { settingsFor, type SettingsStore } from "./settings";

export type Reply = (replyToken: string, text: string) => Promise<void>;

// How many stored messages go to the AI with each new message.
export const AI_HISTORY_LIMIT = 20;

// Never rejects: one failed reply or AI call must not affect the others or crash the process.
export async function handleEvents(
  events: webhook.Event[],
  reply: Reply,
  sessions: SessionStore,
  ai: Ai,
  settings: SettingsStore,
): Promise<void> {
  const results = await Promise.allSettled(
    events.map((event) => handleEvent(event, reply, sessions, ai, settings)),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to handle event:", result.reason);
    }
  }
}

async function handleEvent(
  event: webhook.Event,
  reply: Reply,
  sessions: SessionStore,
  ai: Ai,
  settings: SettingsStore,
): Promise<void> {
  if (event.type !== "message" || event.message.type !== "text" || !event.replyToken) {
    return;
  }
  const { text } = event.message;
  const key = sourceKey(event.source);
  const command = parseCommand(text);
  if (command) {
    const resetHistory = () => {
      if (key) sessions.clear(key);
    };
    // Settings belong to the sender, also in a group.
    const userId = event.source?.userId;
    const userSettings = userId ? settingsFor(settings, userId) : null;
    await reply(event.replyToken, runCommand(command, { resetHistory, settings: userSettings }));
    return;
  }
  // An AI failure throws and is logged by handleEvents: the user gets no reply and nothing is saved.
  const answer = await ai([...history(sessions, key), { role: "user", content: text }]);
  await reply(event.replyToken, answer);
  // Saved only after a successful reply, so the history holds what the user actually saw.
  if (key) {
    sessions.append(key, "user", text);
    sessions.append(key, "assistant", answer);
  }
}

// The window can start on an assistant row (odd limit, or an orphan row); a chat must start with the user.
function history(sessions: SessionStore, key: string | null): StoredMessage[] {
  if (!key) return [];
  const recent = sessions.recent(key, AI_HISTORY_LIMIT);
  return recent[0]?.role === "assistant" ? recent.slice(1) : recent;
}
