import { handleWebhook, type WebhookDeps } from "./webhook";

// LINE webhooks are small; Bun's default (128 MB) would be read in full before the signature check. Bun answers 413 above it.
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

export function createApp(deps: WebhookDeps) {
  return async function handleRequest(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);

    if (req.method === "GET" && pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    if (req.method === "POST" && pathname === "/webhook") {
      return handleWebhook(req, deps);
    }

    return new Response("Not Found", { status: 404 });
  };
}
