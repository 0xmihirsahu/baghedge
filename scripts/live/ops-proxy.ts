// Local owner console against a remote backend: serves /ops locally, forwards /api/* to BAGHEDGE_API_URL.
// No worker or database runs here, so the remote stays the only writer.
import { serveOps } from "../../server/ops/serve";

const target = process.env.BAGHEDGE_API_URL ?? "https://baghedge-api-mainnet.onrender.com";
const port = Number(process.env.PORT ?? 3003);
process.env.OPS_PAGE = "1";

Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const ops = await serveOps(url);
    if (ops) return ops;
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    const headers = new Headers(req.headers);
    headers.delete("origin"); headers.delete("host"); headers.delete("referer");
    const res = await fetch(target + url.pathname + url.search, {
      method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer(),
      redirect: "manual",
    });
    const out = new Headers(res.headers);
    out.delete("content-encoding"); out.delete("content-length");
    // The console runs on plain http://localhost; some browsers (Safari) drop Secure cookies there.
    const cookies = res.headers.getSetCookie();
    out.delete("set-cookie");
    for (const c of cookies) out.append("set-cookie", c.replace(/;\s*Secure/i, "").replace(/SameSite=None/i, "SameSite=Lax"));
    if (process.env.PROXY_LOG === "1") {
      const hasSession = (req.headers.get("cookie") ?? "").includes("baghedge_session=");
      console.log(new Date().toISOString().slice(11, 19), req.method, url.pathname + url.search, res.status, hasSession ? "session" : "no-session");
    }
    return new Response(res.body, { status: res.status, headers: out });
  },
});
console.log(`ops console → ${target}: http://localhost:${port}/ops`);
