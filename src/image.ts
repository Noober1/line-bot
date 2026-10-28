import type { AiImage } from "./ai";

const CONTENT_URL = "https://api-data.line.me/v2/bot/message";
// The strictest per-image limit among the providers a 9router combo may use; LINE already shrinks photos.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// The reply token lives about 60 s and the AI gets 40 s (AI_TIMEOUT_MS): the download must fit before that.
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 10_000;
export const IMAGE_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Downloads the image of a LINE message (contentProvider "line" only). Rejects on any problem.
export type FetchImage = (messageId: string) => Promise<AiImage>;

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

// Only LINE's own content API is fetched, never a URL from the event (no SSRF).
export function createFetchImage(accessToken: string, fetchFn: FetchFn = fetch, timeoutMs = IMAGE_DOWNLOAD_TIMEOUT_MS): FetchImage {
  return async (messageId) => {
    if (!/^\d+$/.test(messageId)) throw new Error("image download: invalid message ID");
    const response = await fetchFn(`${CONTENT_URL}/${messageId}/content`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 202 = still being prepared, 404 = unknown, 410 = unsent (LINE docs): all a failure here.
    if (response.status !== 200) throw new Error(`image download failed: HTTP ${response.status}`);
    const mime = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!IMAGE_TYPES.has(mime)) throw new Error(`image download: type not supported: ${mime || "none"}`);
    if (Number(response.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) throw new Error("image download: too large");
    // shortcut: without Content-Length the whole body is buffered before the size check; LINE sends the header, stream-read if that ever changes.
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("image download: too large");
    return { mime, base64: Buffer.from(bytes).toString("base64") };
  };
}
