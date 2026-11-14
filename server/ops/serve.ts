import { join } from "node:path";

let bundle: Promise<string> | undefined;

/** Serves the localhost owner console. Enabled only with OPS_PAGE=1 and only for loopback hosts. */
export async function serveOps(url: URL): Promise<Response | null> {
  if (url.pathname !== "/ops" && url.pathname !== "/ops/app.js" && url.pathname !== "/ops/config.json") return null;
  if (process.env.OPS_PAGE !== "1" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return new Response("Not found", { status: 404 });
  }
  if (url.pathname === "/ops/config.json") {
    // The WalletConnect project id is public by design (it's embedded in every dApp that uses it).
    return Response.json({ walletConnectProjectId: process.env.WALLETCONNECT_PROJECT_ID ?? null });
  }
  if (url.pathname === "/ops") {
    return new Response(Bun.file(join(import.meta.dir, "index.html")), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  bundle ??= Bun.build({ entrypoints: [join(import.meta.dir, "app.ts")], target: "browser", minify: false }).then(async result => {
    if (!result.success) throw new Error(result.logs.map(l => String(l)).join("\n"));
    return result.outputs[0]!.text();
  });
  try {
    return new Response(await bundle, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    bundle = undefined;
    return new Response(`console.error(${JSON.stringify(String(error))})`, { status: 500, headers: { "Content-Type": "text/javascript" } });
  }
}
