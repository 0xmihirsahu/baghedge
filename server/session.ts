import { bytesToHex, verifyMessage, type Hex } from "viem";
import { isEvmAddress } from "../shared/amounts";
import type { Db, Env } from "./db";
import { isRecord, RequestError } from "./http";

const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;
export const SESSION_COOKIE = "baghedge_session";

/** The exact text the wallet signs (EIP-191). Bound to origin, environment, address, nonce and expiry. */
export function challengeMessage(c: { origin: string; env: Env; address: string; nonce: string; expiresAt: number }) {
  return [
    "Baghedge sign-in",
    `Origin: ${c.origin}`,
    `Environment: ${c.env}`,
    `Address: ${c.address}`,
    `Nonce: ${c.nonce}`,
    `Expires: ${new Date(c.expiresAt).toISOString()}`,
    "This signature only proves you control this address. It authorizes no trades or transfers.",
  ].join("\n");
}

export function createSessions(opts: { env: Env; db: Db; origin: string; secureCookie: boolean }) {
  const { db, env } = opts;
  db.raw.run(`CREATE TABLE IF NOT EXISTS session_challenges (
    nonce TEXT PRIMARY KEY, env TEXT NOT NULL, address TEXT NOT NULL, expires_at INTEGER NOT NULL)`);
  db.raw.run(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, env TEXT NOT NULL, address TEXT NOT NULL, expires_at INTEGER NOT NULL)`);

  const random = (n: number) => bytesToHex(crypto.getRandomValues(new Uint8Array(n)));
  const cookie = (token: string, maxAgeS: number) =>
    `${SESSION_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${opts.secureCookie ? "; Secure" : ""}`;

  return {
    challenge(body: unknown) {
      const address = isRecord(body) && typeof body.address === "string" ? body.address.toLowerCase() : null;
      if (!isEvmAddress(address)) throw new RequestError(400, "invalid_address", "Provide the wallet address to sign in");
      const nonce = random(16);
      const expiresAt = Date.now() + CHALLENGE_TTL_MS;
      db.raw.query("DELETE FROM session_challenges WHERE expires_at < $now").run({ now: Date.now() });
      db.raw.query("INSERT INTO session_challenges VALUES ($nonce, $env, $address, $expiresAt)").run({ nonce, env, address, expiresAt });
      return { message: challengeMessage({ origin: opts.origin, env, address, nonce, expiresAt }), nonce, expiresAt };
    },

    /** Verifies the signed challenge once, then issues an HttpOnly session cookie. */
    async verify(body: unknown) {
      if (!isRecord(body) || typeof body.nonce !== "string" || typeof body.signature !== "string") {
        throw new RequestError(400, "invalid_signin", "Provide nonce and signature");
      }
      // Single use: the challenge row is deleted whether or not verification succeeds.
      const row = db.raw.query("DELETE FROM session_challenges WHERE nonce = $nonce AND env = $env RETURNING address, expires_at")
        .get({ nonce: body.nonce, env }) as { address: string; expires_at: number } | null;
      if (!row || row.expires_at < Date.now()) throw new RequestError(401, "challenge_expired", "Sign-in challenge expired; request a new one");
      const message = challengeMessage({ origin: opts.origin, env, address: row.address, nonce: body.nonce, expiresAt: row.expires_at });
      const ok = await verifyMessage({ address: row.address as Hex, message, signature: body.signature as Hex }).catch(() => false);
      if (!ok) throw new RequestError(401, "bad_signature", "Signature does not match the challenge address");
      const token = random(32);
      const expiresAt = Date.now() + SESSION_TTL_MS;
      db.raw.query("INSERT INTO sessions VALUES ($token, $env, $address, $expiresAt)").run({ token, env, address: row.address, expiresAt });
      return { body: { address: row.address, expiresAt }, setCookie: cookie(token, SESSION_TTL_MS / 1000) };
    },

    /** Issues a session for an address already proven by another owner signature (e.g. the hedge policy). */
    issue(address: string) {
      const token = random(32);
      const expiresAt = Date.now() + SESSION_TTL_MS;
      db.raw.query("INSERT INTO sessions VALUES ($token, $env, $address, $expiresAt)").run({ token, env, address: address.toLowerCase(), expiresAt });
      return cookie(token, SESSION_TTL_MS / 1000);
    },

    /** Addresses proven by this request's session cookie (one per sign-in; a user may sign in as Trade and Hedge). */
    addresses(req: Request): Set<string> {
      const tokens = (req.headers.get("cookie") ?? "").split(/;\s*/)
        .filter(part => part.startsWith(`${SESSION_COOKIE}=`)).map(part => part.slice(SESSION_COOKIE.length + 1));
      const found = new Set<string>();
      for (const token of tokens) {
        const row = db.raw.query("SELECT address, expires_at FROM sessions WHERE token = $token AND env = $env")
          .get({ token, env }) as { address: string; expires_at: number } | null;
        if (row && row.expires_at > Date.now()) found.add(row.address);
      }
      return found;
    },

    signOut(req: Request) {
      const tokens = (req.headers.get("cookie") ?? "").split(/;\s*/)
        .filter(part => part.startsWith(`${SESSION_COOKIE}=`)).map(part => part.slice(SESSION_COOKIE.length + 1));
      for (const token of tokens) db.raw.query("DELETE FROM sessions WHERE token = $token").run({ token });
      return { body: { signedOut: true }, setCookie: cookie("", 0) };
    },
  };
}

export type Sessions = ReturnType<typeof createSessions>;
