import type { webhook } from "@line/bot-sdk";
import { parseCommand, runCommand } from "./commands";

export type Reply = (replyToken: string, text: string) => Promise<void>;

// Never rejects: one failed reply must not affect the others or crash the process.
export async function handleEvents(events: webhook.Event[], reply: Reply): Promise<void> {
  const results = await Promise.allSettled(events.map((event) => handleEvent(event, reply)));
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to handle event:", result.reason);
    }
  }
}

async function handleEvent(event: webhook.Event, reply: Reply): Promise<void> {
  if (event.type !== "message" || event.message.type !== "text" || !event.replyToken) {
    return;
  }
  const { text } = event.message;
  const command = parseCommand(text);
  await reply(event.replyToken, command ? runCommand(command) : text);
}
