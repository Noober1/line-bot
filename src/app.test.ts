import { describe, expect, test } from "bun:test";
import { handleRequest } from "./app";

describe("handleRequest", () => {
  test("GET /health returns 200 with status ok", async () => {
    const res = handleRequest(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("unknown path returns 404", () => {
    const res = handleRequest(new Request("http://localhost/nope"));
    expect(res.status).toBe(404);
  });

  test("POST /health returns 404", () => {
    const res = handleRequest(new Request("http://localhost/health", { method: "POST" }));
    expect(res.status).toBe(404);
  });
});
