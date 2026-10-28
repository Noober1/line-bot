import { describe, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createApp, MAX_REQUEST_BODY_BYTES } from "./app";
import { captureLog } from "./log";

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

describe("webhook log", () => {
  test("a valid request logs one line with the event count and status, never the body", async () => {
    const out = captureLog("info");
    await setup().app(webhookRequest(textEventBody, sign(textEventBody)));
    out.restore();
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toMatch(/INFO {2}\[webhook\] webhook accepted status=200 events=1 bytes=\d+ ms=\d+/);
    expect(out.lines[0]).not.toContain("rt-1");
  });

  test("a bad signature and a bad body log a warning with the status", async () => {
    const out = captureLog("info");
    const { app } = setup();
    await app(webhookRequest(textEventBody, "nope"));
    await app(webhookRequest("not json", sign("not json")));
    out.restore();
    expect(out.lines[0]).toContain("WARN  [webhook] webhook rejected: bad or missing signature status=401");
    expect(out.lines[1]).toContain("webhook rejected: body is not a LINE event list status=400");
  });

  test("the health check is not logged", async () => {
    const out = captureLog("debug");
    await setup().app(new Request("http://localhost/health"));
    out.restore();
    expect(out.lines).toEqual([]);
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

// The limit lives in Bun.serve, not in the handler, so these tests start a real server on a free port.
function serve() {
  const { app, onEvents } = setup();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: MAX_REQUEST_BODY_BYTES, fetch: app });
  return { server, onEvents };
}

// Bun's fetch rewrites Content-Length and fails with ECONNRESET on a large upload, so send raw headers and read the status line.
async function statusLineFor(port: number, contentLength: number): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  let out = "";
  await Bun.connect({
    hostname: "127.0.0.1",
    port,
    socket: {
      open(socket) {
        socket.write(`POST /webhook HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${contentLength}\r\n\r\n`);
      },
      data(socket, data) {
        out += data.toString();
        if (out.includes("\r\n")) {
          resolve(out.slice(0, out.indexOf("\r\n")));
          socket.end();
        }
      },
      close() {
        resolve(out);
      },
    },
  });
  return promise;
}

describe("request body limit (Bun.serve)", () => {
  test("a body over MAX_REQUEST_BODY_BYTES gets 413 before the handler runs", async () => {
    const { server, onEvents } = serve();
    try {
      expect(await statusLineFor(server.port!,MAX_REQUEST_BODY_BYTES + 1)).toStartWith("HTTP/1.1 413");
      expect(onEvents).not.toHaveBeenCalled();
    } finally {
      server.stop(true);
    }
  });

  test("a body of exactly the limit reaches the handler (unsigned -> 401)", async () => {
    const { server } = serve();
    try {
      const res = await fetch(new URL("/webhook", server.url), { method: "POST", body: "a".repeat(MAX_REQUEST_BODY_BYTES) });
      expect(res.status).toBe(401);
    } finally {
      server.stop(true);
    }
  });

  test("a normal signed webhook still returns 200", async () => {
    const { server, onEvents } = serve();
    try {
      const res = await fetch(new URL("/webhook", server.url), {
        method: "POST",
        headers: { "content-type": "application/json", "x-line-signature": sign(textEventBody) },
        body: textEventBody,
      });
      expect(res.status).toBe(200);
      expect(onEvents).toHaveBeenCalledTimes(1);
    } finally {
      server.stop(true);
    }
  });
});
