import { describe, expect, mock, test } from "bun:test";
import { createFetchImage, MAX_IMAGE_BYTES } from "./image";

const img = (body: ConstructorParameters<typeof Response>[0], headers: Record<string, string>, status = 200) =>
  mock(async (_url: string, _init: RequestInit) => new Response(body, { status, headers }));

describe("createFetchImage", () => {
  test("downloads from LINE's content API with the channel token", async () => {
    const fetchFn = img(new Uint8Array([1, 2, 3]), { "content-type": "image/png" });
    const image = await createFetchImage("tok", fetchFn)("123");
    expect(image).toEqual({ mime: "image/png", base64: "AQID" });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api-data.line.me/v2/bot/message/123/content");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("a message ID that is not digits is rejected without a request", async () => {
    const fetchFn = img(new Uint8Array([1]), { "content-type": "image/png" });
    await expect(createFetchImage("tok", fetchFn)("../x")).rejects.toThrow(/invalid message ID/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test.each([202, 404, 410])("status %d fails", async (status) => {
    const fetchFn = img("", { "content-type": "image/png" }, status);
    await expect(createFetchImage("tok", fetchFn)("1")).rejects.toThrow(`HTTP ${status}`);
  });

  test("a type outside the allowlist fails", async () => {
    const fetchFn = img("<html>", { "content-type": "text/html" });
    await expect(createFetchImage("tok", fetchFn)("1")).rejects.toThrow(/type not supported/);
  });

  test("parameters on the content type are ignored", async () => {
    const fetchFn = img(new Uint8Array([1]), { "content-type": "image/jpeg; charset=binary" });
    expect((await createFetchImage("tok", fetchFn)("1")).mime).toBe("image/jpeg");
  });

  test("a Content-Length over MAX_IMAGE_BYTES fails before reading", async () => {
    const fetchFn = img(new Uint8Array([1]), { "content-type": "image/png", "content-length": String(MAX_IMAGE_BYTES + 1) });
    await expect(createFetchImage("tok", fetchFn)("1")).rejects.toThrow(/too large/);
  });

  test("a body over MAX_IMAGE_BYTES fails", async () => {
    const fetchFn = img(new Uint8Array(MAX_IMAGE_BYTES + 1), { "content-type": "image/png" });
    await expect(createFetchImage("tok", fetchFn)("1")).rejects.toThrow(/too large/);
  });
});
