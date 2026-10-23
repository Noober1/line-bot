import type { StoredMessage } from "./session";

export type AiConfig = {
  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  readonly model: string;
};

// `messages` = chat history plus the new user message, oldest first. Resolves to the answer text.
export type Ai = (messages: readonly StoredMessage[]) => Promise<string>;

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export const SYSTEM_PROMPT =
  "Kamu asisten di chat LINE. Jawab singkat dan jelas, dalam bahasa yang dipakai pengguna. " +
  "LINE tidak menampilkan Markdown, jadi pakai teks biasa tanpa tanda ** # atau tabel.";
export const MAX_ANSWER_TOKENS = 1000;
// LINE rejects text over 5000 characters; stay below it. Task 9 splits long answers instead.
export const MAX_REPLY_CHARS = 4500;
// The LINE reply token is short-lived (about 60 s), so give up before it expires.
export const AI_TIMEOUT_MS = 40_000;

// Talks to any OpenAI-compatible /chat/completions endpoint (9router).
export function createAi(config: AiConfig, fetchFn: FetchFn = fetch, timeoutMs = AI_TIMEOUT_MS): Ai {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return async (messages) => {
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
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
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
    return content.trim().slice(0, MAX_REPLY_CHARS);
  };
}
