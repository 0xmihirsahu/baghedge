import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// local only: signups land in data/waitlist.jsonl until a real form or db is wired
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return Response.json({ error: "invalid email" }, { status: 400 });
  }
  const dir = path.join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, "waitlist.jsonl"), JSON.stringify({ email, at: new Date().toISOString() }) + "\n");
  return Response.json({ ok: true });
}
