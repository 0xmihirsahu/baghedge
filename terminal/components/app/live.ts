"use client";

import { getConnection, signMessage, signTypedData } from "wagmi/actions";
import { useCallback, useEffect, useRef, useState } from "react";
import { evmConfig } from "./evm";
import { info } from "./hl";

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
  rule_active: "A hedge is already running on this account.",
  hedge_account_busy: "The Hedge account has an open position or orders. Clear them first.",
  no_eligible_sol: "The watched wallet has no SOL to hedge.",
  account_alias: "Trade and Hedge must be different accounts.",
  invalid_policy: "The policy changed or was signed by the wrong wallet. Review it again.",
  sign_in_required: "Sign in again to read your hedge.",
  rejected: "You cancelled the signature.",
  wrong_wallet: "Switch your wallet to the Hedge account.",
  unreachable: "Couldn't reach baghedge. Try again in a moment.",
};
const fail = (code: string, message?: string): LiveError => ({ code, message: MESSAGES[code] ?? message ?? "Something went wrong. Try again." });

async function api<T>(path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw fail("unreachable");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(j.error ?? (r.status === 401 ? "sign_in_required" : "unreachable"), j.message);
  return j as T;
}

// wallet prompts: a rejection reads as "cancelled", never a crash
const isReject = (e: unknown) => /reject|denied|cancel/i.test(String((e as { message?: string })?.message ?? e));
async function signTyped(owner: string, t: TypedData) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { EIP712Domain, ...types } = t.types;
  try {
    // the payload comes from the backend at runtime, so viem's compile-time typed-data generics don't apply
    const sign = signTypedData as unknown as (c: typeof evmConfig, p: Record<string, unknown>) => Promise<string>;
    return await sign(evmConfig, { account: owner, domain: t.domain, types, primaryType: t.primaryType, message: t.message });
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
  if (r.reason === "exit-price-outside-band") return "Close blocked";
  if (r.reason === "resize-price-outside-band") return "Resize blocked";
  if (r.reason === "cancelling-hedge-orders") return "Closing";
  if (r.pending?.kind === "entry") return "Entry pending";
  if (r.pending?.kind === "resize") return "Buyback pending";
  if (r.pending?.kind === "close" || r.phase === "closing") return "Closing";
  if (r.phase === "open") return r.stopStatus === "active" ? "Recovery stop active" : r.stopStatus === "missing" ? "Recovery stop missing" : "Checking recovery stop";
  return { armed: "Armed", opening: "Entry pending", closed: "Closed", missed: "Missed entry", expired: "Expired", paused: "Paused" }[r.phase as string] ?? "Armed";
}

export function useLiveHedge(o: { enabled: boolean; trade: string; hedge: string; solana: string | null; agent: string | null }) {
  const [rule, setRule] = useState<Rule | null>(null);
  const [busy, setBusy] = useState<null | "signin" | "approve" | "draft" | "arm" | "close">(null);
  const [error, setError] = useState<LiveError | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [margin, setMargin] = useState<{ need: number; have: number } | null>(null);
  const signedIn = useRef<string | null>(null);

  const owner = o.hedge;
  const chainId = () => getConnection(evmConfig).chainId ?? 1;
  const ensureOwner = () => {
    const a = getConnection(evmConfig).address;
    if (!a || a.toLowerCase() !== owner.toLowerCase()) throw fail("wrong_wallet");
  };

  // a session cookie, signed by the Hedge owner, to read the rule and its events
  const signIn = useCallback(async () => {
    if (signedIn.current === owner.toLowerCase()) return;
    const s = await api<{ address?: string }>("/api/session").catch(() => ({}) as { address?: string });
    if (s.address?.toLowerCase() === owner.toLowerCase()) {
      signedIn.current = owner.toLowerCase();
      return;
    }
    setBusy("signin");
    const { message, nonce } = await api<{ message: string; nonce: string }>("/api/session/challenge", { address: owner });
    let signature: string;
    try {
      signature = await signMessage(evmConfig, { account: owner as `0x${string}`, message });
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
  const ensureAgent = useCallback(async () => {
    if (!o.agent) return;
    const agents = await info<{ address: string }[]>({ type: "extraAgents", user: owner }).catch(() => []);
    if (agents.some((a) => a.address.toLowerCase() === o.agent!.toLowerCase())) return;
    setBusy("approve");
    const { action, typedData } = await api<{ action: unknown; typedData: TypedData }>("/api/hl/approve-agent", { agentAddress: o.agent, chainId: chainId(), purpose: "hedge", validDays: 90 });
    const signature = await signTyped(owner, typedData);
    await api("/api/hl/approve-agent/submit", { owner, action, signature });
  }, [o.agent, owner]);

  // review: sign in, approve the agent if needed, draft the policy and read the margin it needs
  const prepare = useCallback(
    async (p: { cap: number; entry: number; recovery: number; szDecimals?: number }) => {
      setError(null);
      try {
        ensureOwner();
        await signIn();
        await ensureAgent();
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
        const acc = await api<{ hedge: { withdrawableUsdc: string; spotUsdc: { total: string } | null } | null }>(`/api/accounts?trade=${o.trade}&hedge=${owner}`).catch(() => null);
        const have = Math.max(Number(acc?.hedge?.withdrawableUsdc ?? 0), Number(acc?.hedge?.spotUsdc?.total ?? 0));
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
    [o.trade, o.solana, owner, signIn, ensureAgent],
  );

  // arm: the owner signs the drafted policy, the backend records it and the worker starts watching
  const arm = useCallback(async () => {
    if (!draft) return false;
    setError(null);
    setBusy("arm");
    try {
      ensureOwner();
      const ownerSig = await signTyped(owner, draft.typedData);
      await api("/api/hedges", { policy: draft.policy, ownerSig, chainId: chainId() });
      setDraft(null);
      await refresh();
      return true;
    } catch (e) {
      setError(e as LiveError);
      return false;
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, owner, refresh]);

  // close (open short) or disarm (nothing filled yet), with a signed command
  const close = useCallback(async () => {
    if (!rule) return;
    setError(null);
    setBusy("close");
    try {
      ensureOwner();
      const command = rule.phase === "armed" ? "disarm" : "close";
      const c = await api<{ typedData: TypedData; issuedAt: number }>(`/api/hedges/${rule.id}?command=${command}&chainId=${chainId()}`);
      const signature = await signTyped(owner, c.typedData);
      await api(`/api/hedges/${rule.id}/${command}`, { signature, issuedAt: c.issuedAt, chainId: chainId() });
      await refresh();
    } catch (e) {
      setError(e as LiveError);
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule, owner, refresh]);

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
    ["armed", "reserved", "order", "stop", "phase", "paused", "close", "disarm", "cancel-leftovers"].forEach((k) => es.addEventListener(k, on));
    es.onerror = () => {};
    return () => es.close();
  }, [o.enabled, rule?.id, rule?.status, refresh]);

  return { rule, busy, error, setError, draft, margin, prepare, arm, close, cancelDraft: () => setDraft(null) };
}
