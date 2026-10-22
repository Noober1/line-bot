export function handleRequest(req: Request): Response {
  const { pathname } = new URL(req.url);

  if (req.method === "GET" && pathname === "/health") {
    return Response.json({ status: "ok" });
  }

  return new Response("Not Found", { status: 404 });
}
