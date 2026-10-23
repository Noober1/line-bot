import type { webhook } from "@line/bot-sdk";
import { parseCommand, runCommand } from "./commands";
import { sourceKey, type SessionStore } from "./session";

export type Reply = (replyToken: string, text: string) => Promise<void>;

// Never rejects: one failed reply must not affect the others or crash the process.
export async function handleEvents(
  events: webhook.Event[],
  reply: Reply,
  sessions: SessionStore,
): Promise<void> {
  const results = await Promise.allSettled(events.map((event) => handleEvent(event, reply, sessions)));
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to handle event:", result.reason);
    }
  }
}

async function handleEvent(event: webhook.Event, reply: Reply, sessions: SessionStore): Promise<void> {
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
    await reply(event.replyToken, runCommand(command, { resetHistory }));
    return;
  }
  // shortcut: the echo stands in for the AI answer; task 7 replaces it with Claude fed by sessions.recent().
  const answer = text;
  await reply(event.replyToken, answer);
  // Saved only after a successful reply, so the history holds what the user actually saw.
  if (key) {
    sessions.append(key, "user", text);
    sessions.append(key, "assistant", answer);
  }
}
