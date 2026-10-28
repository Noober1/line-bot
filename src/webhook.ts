import { validateSignature, type webhook } from "@line/bot-sdk";
import { logger } from "./log";

const log = logger("webhook");

export type WebhookDeps = {
  readonly channelSecret: string;
  // Called without await: LINE needs a 200 within 2 seconds.
  readonly onEvents: (events: webhook.Event[]) => void;
};

// One log line per request. Bun answers 413 for a too-large body before this code runs, so that case is not logged here.
export async function handleWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  const started = Date.now();
  const signature = req.headers.get("x-line-signature");
  const body = Buffer.from(await req.arrayBuffer());

  if (!signature || !validateSignature(body, deps.channelSecret, signature)) {
    log.warn("webhook rejected: bad or missing signature", { status: 401, bytes: body.length, ms: Date.now() - started });
    return new Response("Unauthorized", { status: 401 });
  }

  const events = parseEvents(body.toString("utf8"));
  if (!events) {
    log.warn("webhook rejected: body is not a LINE event list", { status: 400, bytes: body.length, ms: Date.now() - started });
    return new Response("Bad Request", { status: 400 });
  }

  deps.onEvents(events);
  log.info("webhook accepted", { status: 200, events: events.length, bytes: body.length, ms: Date.now() - started });
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
