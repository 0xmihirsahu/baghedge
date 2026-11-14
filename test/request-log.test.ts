import { describe, expect, test } from "bun:test";
import { withRequestLog } from "../server/index";

describe("withRequestLog", () => {
  const run = async (url: string, res: Response | Error, method = "GET") => {
    const lines: string[] = [];
    const handler = withRequestLog(async () => { if (res instanceof Error) throw res; return res; }, l => lines.push(l));
    const out = await handler(new Request(url, { method, headers: { cookie: "baghedge_session=secret" } })).catch(e => e);
    return { lines, out };
  };

  test("logs method, path, status and the JSON error code, never the query or cookie", async () => {
    const { lines, out } = await run("http://x/api/hedges/agent?owner=0xabc",
      Response.json({ error: "sign_in_required", message: "m" }, { status: 401 }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^GET \/api\/hedges\/agent 401 sign_in_required \d+ms$/);
    expect(lines[0]).not.toContain("0xabc");
    expect(lines[0]).not.toContain("secret");
    expect(await (out as Response).json()).toEqual({ error: "sign_in_required", message: "m" }); // body still readable
  });

  test("skips health checks and non-API paths", async () => {
    expect((await run("http://x/api/health", new Response("ok"))).lines).toEqual([]);
    expect((await run("http://x/ops", new Response("ok"))).lines).toEqual([]);
  });

  test("logs thrown handler errors as 500 and rethrows", async () => {
    const { lines, out } = await run("http://x/api/hedges", new Error("boom"), "POST");
    expect(lines[0]).toMatch(/^POST \/api\/hedges 500 thrown \d+ms$/);
    expect(out).toBeInstanceOf(Error);
  });
});
