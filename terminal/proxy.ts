import { NextResponse, type NextRequest } from "next/server";

// /api goes to the baghedge backend through the rewrites in next.config.ts. the backend refuses any Origin but its one
// APP_ORIGIN, so localhost, previews and testnet.baghedge.xyz would all be rejected. we do that check here instead:
// a request from this site's own page is forwarded without its Origin; one from any other site stops here
export function proxy(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return NextResponse.next();
  if (origin !== req.nextUrl.origin) {
    return NextResponse.json({ error: "origin_rejected", message: "Origin is not allowed" }, { status: 403 });
  }
  const headers = new Headers(req.headers);
  headers.delete("origin");
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/api/:path*" };
