import { validateSignature, type webhook } from "@line/bot-sdk";

export type WebhookDeps = {
  readonly channelSecret: string;
  // Called without await: LINE needs a 200 within 2 seconds.
  readonly onEvents: (events: webhook.Event[]) => void;
};

export async function handleWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  const signature = req.headers.get("x-line-signature");
  const body = Buffer.from(await req.arrayBuffer());

  if (!signature || !validateSignature(body, deps.channelSecret, signature)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const events = parseEvents(body.toString("utf8"));
  if (!events) {
    return new Response("Bad Request", { status: 400 });
  }

  deps.onEvents(events);
  return new Response("OK");
}

function parseEvents(text: string): webhook.Event[] | null {
  try {
    const payload = JSON.parse(text) as Partial<webhook.CallbackRequest> | null;
    return Array.isArray(payload?.events) ? payload.events : null;
  } catch {
    return null;
  }
}
