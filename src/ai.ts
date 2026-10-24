import type { StoredMessage } from "./session";

export type AiConfig = {
  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  readonly model: string;
};

// `messages` = chat history plus the new user message, oldest first. `system` replaces SYSTEM_PROMPT.
// Resolves to the answer text.
export type Ai = (messages: readonly StoredMessage[], system?: string) => Promise<string>;

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

// LINE mobile shows *bold* and Markdown as raw characters, so ask for plain text that still reads well.
export const SYSTEM_PROMPT =
  "You are an assistant in a LINE chat. Answer briefly and clearly. " +
  "Always reply in the same language the user writes in. " +
  "LINE shows replies as plain text, so keep them plain but tidy: short paragraphs separated by a blank line, " +
  'each list item on its own line starting with "• ", and emoji only sparingly. ' +
  "Never format text with Markdown or LINE syntax: no *, **, #, _, ~, backticks, code blocks or tables.";
export const MAX_ANSWER_TOKENS = 1000;
// The LINE reply token is short-lived (about 60 s), so give up before it expires.
export const AI_TIMEOUT_MS = 40_000;

// Talks to any OpenAI-compatible /chat/completions endpoint (9router).
export function createAi(config: AiConfig, fetchFn: FetchFn = fetch, timeoutMs = AI_TIMEOUT_MS): Ai {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return async (messages, system = SYSTEM_PROMPT) => {
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
        messages: [{ role: "system", content: system }, ...messages],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`AI request failed: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    }
    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("AI returned no text");
    }
    return content.trim();
  };
}
