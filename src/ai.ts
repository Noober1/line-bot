import { buildChatPrompts, DEFAULT_PERSONA } from "./persona";
import type { StoredMessage } from "./session";

export type AiConfig = {
  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  readonly model: string;
};

// An image for the newest message, held in memory only. `mime` is one of IMAGE_TYPES (image.ts).
export type AiImage = { readonly mime: string; readonly base64: string };

// `messages` = chat history plus the new user message, oldest first. `system` replaces SYSTEM_PROMPT.
// `image` rides on the newest message. Resolves to the answer text.
export type Ai = (messages: readonly StoredMessage[], system?: string, image?: AiImage) => Promise<string>;

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

// Default 1:1 chat prompt (built-in persona + fixed rules); index.ts builds the configured one.
export const SYSTEM_PROMPT = buildChatPrompts(DEFAULT_PERSONA).dm;
export const MAX_ANSWER_TOKENS = 1000;
// The LINE reply token is short-lived (about 60 s), so give up before it expires.
export const AI_TIMEOUT_MS = 40_000;

// Talks to any OpenAI-compatible /chat/completions endpoint (9router).
export function createAi(config: AiConfig, fetchFn: FetchFn = fetch, timeoutMs = AI_TIMEOUT_MS): Ai {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return async (messages, system = SYSTEM_PROMPT, image) => {
    const last = messages.at(-1);
    // OpenAI-style content parts on the newest message only; the history stays plain text.
    const chat =
      image && last
        ? [
            ...messages.slice(0, -1),
            {
              role: last.role,
              content: [
                { type: "text", text: last.content },
                { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.base64}` } },
              ],
            },
          ]
        : messages;
    const response = await fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: MAX_ANSWER_TOKENS,
        stream: false,
        messages: [{ role: "system", content: system }, ...chat],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      // With an image the error body might echo the base64 back: keep it out of the error (and the log).
      const detail = image ? "" : ` ${(await response.text()).slice(0, 200)}`;
      throw new Error(`AI request failed: HTTP ${response.status}${detail}`);
    }
    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("AI returned no text");
    }
    return content.trim();
  };
}
