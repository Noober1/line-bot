import { describe, expect, mock, test } from "bun:test";
import { createAi, MAX_ANSWER_TOKENS, SYSTEM_PROMPT, type AiConfig } from "./ai";

const config: AiConfig = { baseUrl: "http://router.test/v1", apiKey: undefined, model: "combo-chat" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function answering(content: unknown) {
  return mock(async (_url: string, _init: RequestInit) => jsonResponse({ choices: [{ message: { content } }] }));
}

describe("createAi", () => {
  test("posts the system prompt and messages to /chat/completions", async () => {
    const fetchFn = answering("hai");
    await createAi(config, fetchFn)([
      { role: "user", content: "halo" },
      { role: "assistant", content: "hai" },
      { role: "user", content: "siapa kamu?" },
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://router.test/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "combo-chat",
      max_tokens: MAX_ANSWER_TOKENS,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: "halo" },
        { role: "assistant", content: "hai" },
        { role: "user", content: "siapa kamu?" },
      ],
    });
  });

  test("a custom system prompt replaces SYSTEM_PROMPT", async () => {
    const fetchFn = answering("hai");
    await createAi(config, fetchFn)([{ role: "user", content: "halo" }], "Terjemahkan.");
    expect(JSON.parse(fetchFn.mock.calls[0]![1].body as string).messages).toEqual([
      { role: "system", content: "Terjemahkan." },
      { role: "user", content: "halo" },
    ]);
  });

  test("an image rides on the newest message as text + image_url parts; earlier messages stay strings", async () => {
    const fetchFn = answering("hai");
    await createAi(config, fetchFn)(
      [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "lihat" },
      ],
      "sys",
      { mime: "image/png", base64: "AQID" },
    );
    const { messages } = JSON.parse(fetchFn.mock.calls[0]![1].body as string);
    expect(messages[3]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "lihat" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
      ],
    });
    expect(messages[1].content).toBe("a");
  });

  test("without an image the newest message stays a plain string", async () => {
    const fetchFn = answering("hai");
    await createAi(config, fetchFn)([{ role: "user", content: "halo" }]);
    const { messages } = JSON.parse(fetchFn.mock.calls[0]![1].body as string);
    expect(messages.at(-1).content).toBe("halo");
  });

  test("an HTTP error with an image leaves the response body out of the error", async () => {
    const fetchFn = mock(async (_url: string, _init: RequestInit) => new Response("ECHO iVBOR", { status: 400 }));
    const call = createAi(config, fetchFn)([{ role: "user", content: "x" }], "sys", { mime: "image/png", base64: "AQID" });
    await expect(call).rejects.toThrow(/^AI request failed: HTTP 400$/);
  });

  test("sends no Authorization header without an API key", async () => {
    const fetchFn = answering("hai");
    await createAi(config, fetchFn)([{ role: "user", content: "halo" }]);
    expect(new Headers(fetchFn.mock.calls[0]![1].headers).has("authorization")).toBe(false);
  });

  test("sends the API key as a Bearer token", async () => {
    const fetchFn = answering("hai");
    await createAi({ ...config, apiKey: "k-123" }, fetchFn)([{ role: "user", content: "halo" }]);
    expect(new Headers(fetchFn.mock.calls[0]![1].headers).get("authorization")).toBe("Bearer k-123");
  });

  test("a trailing slash in the base URL does not double up", async () => {
    const fetchFn = answering("hai");
    await createAi({ ...config, baseUrl: "http://router.test/v1///" }, fetchFn)([{ role: "user", content: "x" }]);
    expect(fetchFn.mock.calls[0]![0]).toBe("http://router.test/v1/chat/completions");
  });

  test("returns the trimmed answer text", async () => {
    const ai = createAi(config, answering("  halo juga \n"));
    expect(await ai([{ role: "user", content: "halo" }])).toBe("halo juga");
  });

  test("does not cut a long answer: the reply splits it into several messages", async () => {
    const ai = createAi(config, answering("a".repeat(6000)));
    expect(await ai([{ role: "user", content: "x" }])).toHaveLength(6000);
  });

  test("a non-2xx response throws with the status and a cut body", async () => {
    const fetchFn = mock(async (_url: string, _init: RequestInit) => new Response("x".repeat(1000), { status: 429 }));
    const error = await createAi(config, fetchFn)([{ role: "user", content: "x" }]).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toStartWith("AI request failed: HTTP 429 ");
    expect((error as Error).message.length).toBeLessThan(260);
  });

  test("a response without text throws", async () => {
    for (const content of ["", "   ", null, 42]) {
      await expect(createAi(config, answering(content))([{ role: "user", content: "x" }])).rejects.toThrow(
        "AI returned no text",
      );
    }
  });

  test("a body without choices throws", async () => {
    const fetchFn = mock(async (_url: string, _init: RequestInit) => jsonResponse({ error: "nope" }));
    await expect(createAi(config, fetchFn)([{ role: "user", content: "x" }])).rejects.toThrow("AI returned no text");
  });

  test("a network error is passed on", async () => {
    const fetchFn = mock(async (_url: string, _init: RequestInit): Promise<Response> => {
      throw new Error("ECONNREFUSED");
    });
    await expect(createAi(config, fetchFn)([{ role: "user", content: "x" }])).rejects.toThrow("ECONNREFUSED");
  });

  test("aborts the request after the timeout", async () => {
    const hanging = mock(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    await expect(createAi(config, hanging, 20)([{ role: "user", content: "x" }])).rejects.toThrow();
  });
});

describe("SYSTEM_PROMPT", () => {
  test("is in English and asks for a reply in the user's language", () => {
    expect(SYSTEM_PROMPT).toContain("You are Elysia, an assistant in a LINE chat.");
    expect(SYSTEM_PROMPT).toContain("Always reply in the same language the user writes in.");
  });

  test("asks for plain but tidy text: blank-line paragraphs, • bullets, sparse emoji", () => {
    expect(SYSTEM_PROMPT).toContain("short paragraphs separated by a blank line");
    expect(SYSTEM_PROMPT).toContain('"• "');
    expect(SYSTEM_PROMPT).toContain("emoji");
  });

  test("forbids every formatting character LINE mobile shows raw", () => {
    for (const forbidden of ["*", "**", "#", "_", "~", "backticks", "tables"]) {
      expect(SYSTEM_PROMPT).toContain(forbidden);
    }
    expect(SYSTEM_PROMPT).toContain("Never format text");
  });
});
