import { describe, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createApp } from "./app";

const SECRET = "test-secret";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

function setup() {
  const onEvents = mock((_events: unknown[]) => {});
  const app = createApp({ channelSecret: SECRET, onEvents });
  return { app, onEvents };
}

function webhookRequest(body: string, signature?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== undefined) headers["x-line-signature"] = signature;
  return new Request("http://localhost/webhook", { method: "POST", headers, body });
}

const textEventBody = JSON.stringify({
  destination: "U0",
  events: [
    {
      type: "message",
      replyToken: "rt-1",
      message: { type: "text", id: "m1", text: "hi", quoteToken: "q" },
    },
  ],
});

describe("health", () => {
  test("GET /health returns 200 with status ok", async () => {
    const res = await setup().app(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("unknown path returns 404", async () => {
    const res = await setup().app(new Request("http://localhost/nope"));
    expect(res.status).toBe(404);
  });

  test("POST /health returns 404", async () => {
    const res = await setup().app(new Request("http://localhost/health", { method: "POST" }));
    expect(res.status).toBe(404);
  });
});

describe("POST /webhook", () => {
  test("valid signature returns 200 and passes events to onEvents", async () => {
    const { app, onEvents } = setup();
    const res = await app(webhookRequest(textEventBody, sign(textEventBody)));
    expect(res.status).toBe(200);
    expect(onEvents).toHaveBeenCalledTimes(1);
    expect(onEvents.mock.calls[0]![0]).toEqual(JSON.parse(textEventBody).events);
  });

  test("empty events (console Verify) returns 200", async () => {
    const { app, onEvents } = setup();
    const body = JSON.stringify({ destination: "U0", events: [] });
    const res = await app(webhookRequest(body, sign(body)));
    expect(res.status).toBe(200);
    expect(onEvents).toHaveBeenCalledWith([]);
  });

  test("missing signature returns 401", async () => {
    const { app, onEvents } = setup();
    const res = await app(webhookRequest(textEventBody));
    expect(res.status).toBe(401);
    expect(onEvents).not.toHaveBeenCalled();
  });

  test("signature made with another secret returns 401", async () => {
    const { app, onEvents } = setup();
    const res = await app(webhookRequest(textEventBody, sign(textEventBody, "wrong-secret")));
    expect(res.status).toBe(401);
    expect(onEvents).not.toHaveBeenCalled();
  });

  test("tampered body returns 401", async () => {
    const { app, onEvents } = setup();
    const tampered = textEventBody.replace("hi", "hacked");
    const res = await app(webhookRequest(tampered, sign(textEventBody)));
    expect(res.status).toBe(401);
    expect(onEvents).not.toHaveBeenCalled();
  });

  test("garbage signature returns 401", async () => {
    const { app } = setup();
    const res = await app(webhookRequest(textEventBody, "not-base64!!"));
    expect(res.status).toBe(401);
  });

  test("signed non-JSON body returns 400", async () => {
    const { app, onEvents } = setup();
    const body = "not json";
    const res = await app(webhookRequest(body, sign(body)));
    expect(res.status).toBe(400);
    expect(onEvents).not.toHaveBeenCalled();
  });

  test("signed JSON without events array returns 400", async () => {
    const { app, onEvents } = setup();
    const body = JSON.stringify({ destination: "U0" });
    const res = await app(webhookRequest(body, sign(body)));
    expect(res.status).toBe(400);
    expect(onEvents).not.toHaveBeenCalled();
  });

  test("signed JSON null returns 400", async () => {
    const { app } = setup();
    const res = await app(webhookRequest("null", sign("null")));
    expect(res.status).toBe(400);
  });

  test("GET /webhook returns 404", async () => {
    const res = await setup().app(new Request("http://localhost/webhook"));
    expect(res.status).toBe(404);
  });
});
