"use client";

import { getConnection, signMessage, signTypedData } from "wagmi/actions";
import { useCallback, useEffect, useRef, useState } from "react";
import { evmConfig } from "./evm";
import { explorer, info } from "./hl";
import type { Signer } from "./privy";

// the real hedge, through the baghedge backend (docs/INTEGRATION.md, docs/API.md). the backend holds no owner keys:
// every owner action is signed here in the user's EVM wallet. flow: sign in → approve the hedge agent once →
// draft the policy → review → sign and arm → live status from the rule → close with a signed command

export type Rule = {
  id: string;
  env: string;
  status: "active" | "done";
  phase: "armed" | "opening" | "open" | "closing" | "closed" | "missed" | "expired" | "paused";
  reason: string | null;
  shortLots: string;
  stopStatus: "none" | "checking" | "active" | "missing";
  pending: { kind: "entry" | "resize" | "close"; lots: string } | null;
  signerKind: "fallback" | "guard";
  policy: Record<string, unknown>;
  actions: { intent: string; transport: string; outcome: string | null }[];
  fills: { tid: number; px: string; sz: string; side: string; time: number; fee: string }[];
};
export type Draft = { policy: Record<string, unknown>; typedData: TypedData; requiredMarginUsdc: string };
type TypedData = { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> };
export type LiveError = { code: string; message: string };

// every refusal in one plain sentence, shown where the user acted (docs/INTEGRATION.md §4)
const MESSAGES: Record<string, string> = {
  entry_already_crossed: "SOL is already below your entry. Lower the entry and try again.",
  insufficient_margin: "The Hedge account needs more USDC for this hedge.",
  margin_unavailable: "Couldn't read the Hedge account's margin. Try again.",
  rule_active: "A hedge is already running on this account.",
  hedge_account_busy: "The Hedge account has an open position or orders. Clear them first.",
  no_eligible_sol: "The watched wallet has no SOL to hedge.",
  account_alias: "Trade and Hedge must be different accounts.",
  owner_unsupported: "Mainnet hedging is open to the pilot account only, for now.",
  agent_unknown: "Your hedge agent isn't ready yet. Try again.",
  agent_lookup_rate_limited: "Still setting up your hedge agent. Try again in a minute.",
  agent_lookup_busy: "Lots of new accounts right now. Try again later.",
  invalid_policy: "The policy changed or was signed by the wrong wallet. Review it again.",
  sign_in_required: "Sign in again to read your hedge.",
  rejected: "You cancelled the signature.",
  wrong_wallet: "Switch your wallet to the Hedge account.",
  unreachable: "Couldn't reach baghedge. Try again in a moment.",
};
const fail = (code: string, message?: string): LiveError => ({ code, message: MESSAGES[code] ?? message ?? "Something went wrong. Try again." });

async function api<T>(path: string, body?: unknown, timeout = 20_000): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", signal: AbortSignal.timeout(timeout) });
  } catch {
    throw fail("unreachable");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(j.error ?? (r.status === 401 ? "sign_in_required" : "unreachable"), j.message);
  return j as T;
}

// wallet prompts: a rejection reads as "cancelled", never a crash
const isReject = (e: unknown) => /reject|denied|cancel/i.test(String((e as { message?: string })?.message ?? e));
// an external wallet (metamask, rabby, walletconnect) through wagmi; it must be connected as the owner
export const externalSigner: Signer = {
  kind: "external",
  message: (account, message) => signMessage(evmConfig, { account: account as `0x${string}`, message }),
  // the payload comes from the backend at runtime, so viem's compile-time typed-data generics don't apply
  typed: (account, p) => (signTypedData as unknown as (c: typeof evmConfig, p: Record<string, unknown>) => Promise<string>)(evmConfig, { account, ...p }),
  chainId: () => getConnection(evmConfig).chainId ?? 1,
};

async function signTyped(signer: Signer | null, owner: string, t: TypedData) {
  if (!signer) throw fail("wrong_wallet");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { EIP712Domain, ...types } = t.types;
  try {
    return await signer.typed(owner, { domain: t.domain, types, primaryType: t.primaryType, message: t.message });
  } catch (e) {
    throw fail(isReject(e) ? "rejected" : "unknown", "The wallet couldn't sign.");
  }
}

// prices as the venue takes them: 5 significant figures, at most 6 − szDecimals decimals (AGENTS.md rule 3)
const px = (v: number, szDecimals = 2) => {
  const sig = v >= 1 ? 5 - (Math.floor(Math.log10(v)) + 1) : 5;
  return v.toFixed(Math.max(0, Math.min(6 - szDecimals, sig)));
};

export function ruleLabel(r: Rule): string {
  if (r.actions?.some((a) => a.transport === "unknown")) return "Checking order";
  if (r.reason === "exit-price-outside-band" || r.reason?.startsWith("close-blocked")) return "Close blocked";
  if (r.reason === "resize-price-outside-band" || r.reason?.startsWith("resize-blocked")) return "Resize blocked";
  if (r.reason === "cancelling-hedge-orders") return "Closing";
  if (r.reason === "recovery-stop-filled") return "Closed by recovery stop";
  if (r.reason === "recovery-stop-partial") return "Recovery stop partially filled";
  if (r.pending?.kind === "entry") return "Entry pending";
  if (r.pending?.kind === "resize") return "Buyback pending";
  if (r.pending?.kind === "close" || r.phase === "closing") return "Closing";
  if (r.phase === "open") return r.stopStatus === "active" ? "Recovery stop active" : r.stopStatus === "missing" ? "Recovery stop missing" : "Checking recovery stop";
  return { armed: "Armed", opening: "Entry pending", closed: "Closed", missed: "Missed entry", expired: "Expired", paused: "Paused" }[r.phase as string] ?? "Armed";
}

export function useLiveHedge(o: { enabled: boolean; trade: string; hedge: string; solana: string | null; agent: string | null; signer: Signer | null; notify?: (title: string, status: string, href?: string) => void }) {
  const [rule, setRule] = useState<Rule | null>(null);
  const [busy, setBusy] = useState<null | "signin" | "agent" | "approve" | "draft" | "arm" | "close">(null);
  const [error, setError] = useState<LiveError | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [margin, setMargin] = useState<{ need: number; have: number | null } | null>(null);
  const signedIn = useRef<string | null>(null);

  const owner = o.hedge;
  // the signer changes identity every render; the callbacks read the latest through a ref
  const signerRef = useRef<Signer | null>(o.signer);
  useEffect(() => {
    signerRef.current = o.signer;
  }, [o.signer]);
  const notifyRef = useRef(o.notify);
  useEffect(() => {
    notifyRef.current = o.notify;
  }, [o.notify]);
  const chainId = () => signerRef.current?.chainId() ?? 1;
  const ensureOwner = () => {
    const s = signerRef.current;
    if (!s) throw fail("wrong_wallet");
    if (s.kind === "external" && getConnection(evmConfig).address?.toLowerCase() !== owner.toLowerCase()) throw fail("wrong_wallet");
  };

  // a session cookie, signed by the Hedge owner, to read the rule and its events
  const signIn = useCallback(async () => {
    if (signedIn.current === owner.toLowerCase()) return;
    // GET /api/session answers { addresses }: already signed in as the owner means no new signature
    const s = await api<{ addresses?: string[] }>("/api/session").catch(() => ({}) as { addresses?: string[] });
    if (s.addresses?.some((a) => a.toLowerCase() === owner.toLowerCase())) {
      signedIn.current = owner.toLowerCase();
      return;
    }
    setBusy("signin");
    const { message, nonce } = await api<{ message: string; nonce: string }>("/api/session/challenge", { address: owner });
    let signature: string;
    try {
      if (!signerRef.current) throw fail("wrong_wallet");
      signature = await signerRef.current.message(owner, message);
    } catch (e) {
      throw fail(isReject(e) ? "rejected" : "unknown", "The wallet couldn't sign in.");
    }
    await api("/api/session/verify", { nonce, signature });
    signedIn.current = owner.toLowerCase();
  }, [owner]);

  // the current rule for this Hedge account, if any
  const refresh = useCallback(async () => {
    if (!o.enabled || signedIn.current !== owner.toLowerCase()) return;
    try {
      const r = await api<{ rules: Rule[] }>(`/api/hedges?hedge=${owner}`);
      setRule(r.rules?.[0] ?? null);
    } catch (e) {
      if ((e as LiveError).code === "sign_in_required") signedIn.current = null;
    }
  }, [o.enabled, owner]);

  // the hedge agent must be approved on the Hedge account once (after it is funded)
  // multi-owner guard: every Hedge owner has its own agent, read after sign-in (the first lookup takes 5–10 s).
  // a backend without the route (single-owner build) answers 404, and the agent from /api/health is used
  const agentFor = useRef<{ owner: string; agent: string } | null>(null);
  const ownerAgent = useCallback(async () => {
    if (agentFor.current?.owner === owner.toLowerCase()) return agentFor.current.agent;
    setBusy("agent");
    let agent = o.agent;
    // the first lookup for a new owner runs the guard on OutLayer: 10–30 s. a lapsed session (or an agent the
    // server hasn't looked up yet) means: sign in again, then ask once more
    const lookup = () => api<{ agentAddress: string }>(`/api/hedges/agent?owner=${owner}`, undefined, 60_000).then((r) => r.agentAddress);
    try {
      agent = await lookup();
    } catch (e) {
      const code = (e as LiveError).code;
      if (code === "sign_in_required" || code === "agent_unknown") {
        signedIn.current = null;
        await signIn();
        setBusy("agent");
        agent = await lookup();
      } else if (code !== "not_found") throw e;
    }
    if (agent) agentFor.current = { owner: owner.toLowerCase(), agent };
    return agent;
  }, [o.agent, owner, signIn]);

  const ensureAgent = useCallback(async () => {
    const agent = await ownerAgent();
    if (!agent) return;
    const agents = await info<{ address: string }[]>({ type: "extraAgents", user: owner }).catch(() => []);
    if (agents.some((a) => a.address.toLowerCase() === agent.toLowerCase())) return;
    setBusy("approve");
    const { action, typedData } = await api<{ action: unknown; typedData: TypedData }>("/api/hl/approve-agent", { agentAddress: agent, chainId: chainId(), purpose: "hedge", validDays: 90 });
    const signature = await signTyped(signerRef.current, owner, typedData);
    await api("/api/hl/approve-agent/submit", { owner, action, signature });
    // approvals are Hyperliquid actions with no tx page of their own: link the account's history, where it shows
    notifyRef.current?.("Hedge agent", "Approved", explorer("address", owner));
  }, [ownerAgent, owner]);

  // review: sign in, approve the agent if needed, draft the policy and read the margin it needs
  const prepare = useCallback(
    async (p: { cap: number; entry: number; recovery: number; szDecimals?: number }) => {
      setError(null);
      try {
        ensureOwner();
        await signIn();
        // the agent must be known before drafting (the policy names it); approving it waits for arm, because
        // Hyperliquid accepts the approval only once the Hedge account holds USDC
        await ownerAgent();
        setBusy("draft");
        const d = await api<Draft>("/api/hedges/draft", {
          tradeAddress: o.trade,
          hedgeAddress: owner,
          solanaAddress: o.solana,
          maxSol: p.cap.toFixed(2),
          entryMark: px(p.entry, p.szDecimals),
          entryFloor: px(p.entry * 0.98, p.szDecimals),
          recoveryMark: px(p.recovery, p.szDecimals),
          exitCeiling: px(p.recovery * 1.01, p.szDecimals),
          expiresAt: Date.now() + 7 * 24 * 3600e3,
          chainId: chainId(),
        });
        // usableUsdc is the margin that counts on both standard and unified accounts (docs/API.md)
        const acc = await api<{ hedge: { usableUsdc?: string | null; accountMode?: string } | null }>(`/api/accounts?trade=${o.trade}&hedge=${owner}`).catch(() => null);
        // null usableUsdc means the venue read failed: show it as unknown, never as zero
        const have = acc?.hedge?.usableUsdc != null ? Number(acc.hedge.usableUsdc) : null;
        setMargin({ need: Number(d.requiredMarginUsdc), have });
        setDraft(d);
        return d;
      } catch (e) {
        setError(e as LiveError);
        return null;
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [o.trade, o.solana, owner, signIn, ownerAgent],
  );

  // arm: the owner signs the drafted policy, the backend records it and the worker starts watching
  const arm = useCallback(async () => {
    if (!draft) return false;
    setError(null);
    setBusy("arm");
    try {
      ensureOwner();
      // order: sign in → agent known → funded → approve the agent once → sign the policy
      await ensureAgent();
      setBusy("arm");
      const ownerSig = await signTyped(signerRef.current, owner, draft.typedData);
      await api("/api/hedges", { policy: draft.policy, ownerSig, chainId: chainId() });
      setDraft(null);
      await refresh();
      notifyRef.current?.("Hedge", "Armed", explorer("address", owner));
      return true;
    } catch (e) {
      setError(e as LiveError);
      return false;
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, owner, refresh, ensureAgent]);

  // close (open short) or disarm (nothing filled yet), with a signed command
  const close = useCallback(async () => {
    if (!rule) return;
    setError(null);
    setBusy("close");
    try {
      ensureOwner();
      const command = rule.phase === "armed" ? "disarm" : "close";
      const c = await api<{ typedData: TypedData; issuedAt: number }>(`/api/hedges/${rule.id}?command=${command}&chainId=${chainId()}`);
      const signature = await signTyped(signerRef.current, owner, c.typedData);
      // the status comes from the server's answer, never assumed
      const v = await api<Rule>(`/api/hedges/${rule.id}/${command}`, { signature, issuedAt: c.issuedAt, chainId: chainId() });
      setRule(v?.status === "active" ? v : null);
      await refresh();
      notifyRef.current?.("Hedge", v?.status === "active" ? "Closing" : command === "disarm" ? "Disarmed" : "Closed", explorer("address", owner));
    } catch (e) {
      setError(e as LiveError);
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule, owner, refresh]);

  // on load: an armed hedge must show without pressing anything. reuse the backend session if there is one (it lasts
  // 12 h, no signature); otherwise a Privy wallet signs in silently. then read the rule
  useEffect(() => {
    if (!o.enabled || !owner) return;
    let gone = false;
    (async () => {
      const s = await api<{ addresses?: string[] }>("/api/session").catch(() => ({}) as { addresses?: string[] });
      if (gone) return;
      if (s.addresses?.some((a) => a.toLowerCase() === owner.toLowerCase())) signedIn.current = owner.toLowerCase();
      else if (signerRef.current?.kind === "privy") await signIn().catch(() => {});
      if (!gone) {
        setBusy(null);
        refresh();
      }
    })();
    return () => {
      gone = true;
    };
  }, [o.enabled, owner, signIn, refresh]);

  // live status: server-sent events for every rule change, and a slow poll as a fallback
  useEffect(() => {
    if (!o.enabled) return;
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 8000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [o.enabled, refresh]);
  useEffect(() => {
    if (!o.enabled || !rule?.id || rule.status === "done") return;
    const es = new EventSource(`/api/events?rule=${rule.id}`);
    const on = () => refresh();
    ["armed", "reserved", "order", "stop", "phase", "paused", "close", "disarm", "cancel-leftovers", "stop-filled"].forEach((k) => es.addEventListener(k, on));
    es.onerror = () => {};
    return () => es.close();
  }, [o.enabled, rule?.id, rule?.status, refresh]);

  return { rule, busy, error, setError, draft, margin, prepare, arm, close, cancelDraft: () => setDraft(null) };
}
