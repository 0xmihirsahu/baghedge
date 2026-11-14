import { solBalance } from "@/lib/sol";

// GET /api/balance?address=<solana>: liquid SOL for the watched wallet. the rpc key stays in lib/sol.ts, server only
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return Response.json({ error: "bad address" }, { status: 400 });
  const out = await solBalance(address);
  return out ? Response.json(out) : Response.json({ error: "couldn't read the balance" }, { status: 502 });
}
