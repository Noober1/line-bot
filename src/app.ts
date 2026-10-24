import { handleWebhook, type WebhookDeps } from "./webhook";

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
