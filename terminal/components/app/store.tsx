"use client";

import { WalletReadyState, type WalletError } from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MomentCard, type Moment, type MomentKind } from "../moment";
import { WalletModal } from "../wallet-modal";
import { risk, usd } from "./format";
import { useMarkets } from "./hl";
import { isSolAddress, short, useSolBalance } from "./wallet";

// everything the pages share: live markets, the wallet, toasts, activity, the hyperliquid accounts and the hedge.
// the wallet connects through solana wallet adapter (anza, apache-2.0): any wallet-standard wallet, autoconnect.
// our own picker draws it (wallet-modal.tsx). the browser holds no rpc key; balances come from /api/balance
export type Phase = "draft" | "signing" | "detected" | "transit" | "credited" | "armed" | "entry" | "open" | "buyback" | "closing" | "closed";
export const STATUS: Record<Phase, string> = {
  draft: "Draft", signing: "Awaiting signature", detected: "Deposit detected", transit: "In transit", credited: "Credited",
  armed: "Armed", entry: "Entry pending", open: "Recovery stop active", buyback: "Buyback pending", closing: "Closing", closed: "Closed",
};
export const AUTO: Partial<Record<Phase, [Phase, number]>> = {
  signing: ["detected", 1300], detected: ["transit", 1200], transit: ["credited", 2600], entry: ["open", 1400], buyback: ["open", 1600], closing: ["closed", 1500],
};
export const FUNDING: Phase[] = ["signing", "detected", "transit", "credited"];

type Toast = { id: number; title: string; status: string; kind: "replay" | "error" | "info" };
type Activity = { at: number; what: string };

function useTerminal() {
  const { markets, mids, live } = useMarkets();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);

  // a toast for every event; replay events also go to the activity list, labelled (AGENTS.md rule 15)
  const toast = useCallback((title: string, status: string, kind: Toast["kind"] = "replay") => {
    const id = Math.random();
    setToasts((v) => [...v.slice(-2), { id, title, status, kind }]);
    if (kind === "replay") setActivity((v) => [{ at: Date.now(), what: `${title} ${status.toLowerCase()}` }, ...v]);
    setTimeout(() => setToasts((v) => v.filter((x) => x.id !== id)), kind === "error" ? 4000 : 3200);
  }, []);
  const fail = useCallback((message: string) => toast("Wallet", message, "error"), [toast]);

  // the key moments get a film card instead of a toast (components/moment.tsx). hedge moments are replays and
  // also go to the activity list, as toasts did
  const [momentNow, setMomentNow] = useState<Moment | null>(null);
  const moment = useCallback((kind: MomentKind, title: string, line: string) => {
    setMomentNow({ id: Math.random(), kind, title, line });
    if (kind !== "connected") setActivity((v) => [{ at: Date.now(), what: title }, ...v]);
  }, []);
  const clearMoment = useCallback(() => setMomentNow(null), []);

  // the connected wallet, or a watched address when nothing is connected
  const adapter = useWallet();
  const [picker, setPicker] = useState(false);
  const closePicker = useCallback(() => setPicker(false), []);
  const [watched, setWatched] = useState<string | null>(null);
  useEffect(() => {
    try {
      const w = localStorage.getItem("bh:watch");
      if (w && isSolAddress(w)) setTimeout(() => setWatched(w), 0);
    } catch {}
  }, []);
  const address = adapter.publicKey?.toBase58() ?? watched;
  // only a connect the user asked for gets a moment, never the autoconnect at page load
  const asked = useRef(false);
  const key = adapter.publicKey?.toBase58();
  const walletName = adapter.wallet?.adapter.name;
  useEffect(() => {
    if (!key || !asked.current) return;
    asked.current = false;
    const t = setTimeout(() => moment("connected", "Wallet connected", `${walletName ?? "Wallet"} · ${short(key)}`), 0);
    return () => clearTimeout(t);
  }, [key, walletName, moment]);
  const sol = useSolBalance(address, fail);
  const wallet = {
    address,
    connected: !!adapter.publicKey,
    name: adapter.wallet?.adapter.name ?? null,
    sol,
    connecting: adapter.connecting,
    connect: () => {
      asked.current = true;
      setPicker(true);
    },
    picker,
    closePicker,
    watch: (a: string) => {
      if (!isSolAddress(a)) return false;
      setWatched(a.trim());
      try {
        localStorage.setItem("bh:watch", a.trim());
      } catch {}
      return true;
    },
    forget: () => {
      if (adapter.publicKey) adapter.disconnect().catch(() => {});
      setWatched(null);
      try {
        localStorage.removeItem("bh:watch");
      } catch {}
    },
  };

  // the two hyperliquid master accounts, read by public address. they must differ (AGENTS.md rule 8)
  const [accounts, setAccountsState] = useState<{ trade: string; hedge: string }>({ trade: "", hedge: "" });
  useEffect(() => {
    try {
      const a = JSON.parse(localStorage.getItem("bh:accounts") ?? "null");
      if (a) setTimeout(() => setAccountsState(a), 0);
    } catch {}
  }, []);
  const setAccounts = (a: { trade: string; hedge: string }) => {
    setAccountsState(a);
    try {
      localStorage.setItem("bh:accounts", JSON.stringify(a));
    } catch {}
  };

  // the hedge, as a replay: signing, funding and orders are simulated, the mark and the wallet are real
  const held = sol ?? 0;
  const mark = mids.SOL;
  const [phase, setPhase] = useState<Phase>("draft");
  const [hedge, setHedge] = useState(0);
  const [cap, setCap] = useState("0");
  const [entry, setEntry] = useState(0);
  const [recovery, setRecovery] = useState(0);
  const capN = Math.min(Number(cap) || 0, held);
  const maxLev = markets.find((m) => m.name === "SOL")?.maxLeverage ?? 20;
  // arming is a user step, so it gets its moment here rather than from an effect
  const go = (p: Phase) => {
    if (p === "armed") moment("armed", "Hedge armed", `Replay · short opens below ${usd(entry)}`);
    setPhase(p);
  };

  // starting prices from the live mark, and a starting cap of half the wallet once it's read
  useEffect(() => {
    if (!mark || entry) return;
    const t = setTimeout(() => {
      setEntry(Math.round(mark * 0.97 * 100) / 100);
      setRecovery(Math.round(mark * 1.03 * 100) / 100);
    }, 0);
    return () => clearTimeout(t);
  }, [mark, entry]);
  const capFor = useRef<string | null>(null);
  useEffect(() => {
    if (sol === null || capFor.current === address) return;
    capFor.current = address;
    const t = setTimeout(() => setCap(String(Math.floor((sol / 2) * 100) / 100)), 0);
    return () => clearTimeout(t);
  }, [sol, address]);

  // replay steps that move on by themselves. the numbers for the moment lines are read when the step lands, from a ref,
  // so a ticking mark doesn't restart the step's timer
  const now = useRef({ capN, held, hedge, entry, recovery, maxLev, mark });
  useEffect(() => {
    now.current = { capN, held, hedge, entry, recovery, maxLev, mark };
  });
  useEffect(() => {
    const next = AUTO[phase];
    if (!next) return;
    const t = setTimeout(() => {
      const { capN, held, hedge, entry, recovery, maxLev, mark } = now.current;
      if (phase === "entry") {
        setHedge(-capN);
        moment("filled", "Short filled", `Replay · ${capN.toFixed(2)} SOL at ${usd(entry)}`);
      }
      if (phase === "buyback") {
        setHedge(-held);
        moment("buyback", "Buyback filled", `Replay · ${(-hedge - held).toFixed(2)} SOL bought back`);
      }
      if (phase === "closing") {
        setHedge(0);
        moment("closed", "Hedge closed", `Replay · ${(-hedge).toFixed(2)} SOL${mark ? ` at ${usd(mark)}` : ""}`);
      }
      if (phase === "transit") moment("credited", "Deposit credited", `Replay · ${risk(capN, entry, recovery, maxLev).margin.toFixed(2)} USDC margin`);
      setPhase(next[0]);
    }, next[1]);
    return () => clearTimeout(t);
  }, [phase, moment]);

  // the live mark drives the rule: a real crossing down through the entry, or up to the recovery
  useEffect(() => {
    if (!mark) return;
    const t = setTimeout(() => {
      if (phase === "armed" && mark <= entry) setPhase("entry");
      if (phase === "open" && mark >= recovery) setPhase("closing");
    }, 0);
    return () => clearTimeout(t);
  }, [mark, phase, entry, recovery]);

  // the real wallet drives resizing: if the watched SOL drops below the short, buy back the excess
  useEffect(() => {
    if (phase !== "open" || !sol || -hedge <= sol + 1e-9) return;
    const t = setTimeout(() => setPhase("buyback"), 0);
    return () => clearTimeout(t);
  }, [sol, hedge, phase]);

  const hedgeState = { phase, setPhase: go, hedge, cap, setCap, capN, entry, setEntry, recovery, setRecovery, held };
  return { markets, mids, live, toasts, toast, moment, momentNow, clearMoment, activity, wallet, accounts, setAccounts, hedge: hedgeState };
}

const Ctx = createContext<ReturnType<typeof useTerminal> | null>(null);
export const useStore = () => useContext(Ctx)!;

// the wallet provider sits above the store, so its errors reach the toasts through this one handler
let onWalletError: ((e: WalletError) => void) | null = null;

function Store({ children }: { children: ReactNode }) {
  const value = useTerminal();
  const { toast } = value;
  // wallet adapter errors become short toasts, never raw text on the page
  useEffect(() => {
    onWalletError = (e) => {
      const name = e.name ?? "";
      if (name === "WalletNotReadyError") toast("Wallet", "Not installed", "error");
      else if (name === "WalletConnectionError" || /reject|cancel/i.test(e.message)) toast("Wallet", "Connection cancelled", "error");
      else if (name === "WalletDisconnectedError") toast("Wallet", "Disconnected", "info");
      else toast("Wallet", "Something went wrong", "error");
    };
    return () => {
      onWalletError = null;
    };
  }, [toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <WalletModal open={value.wallet.picker} onClose={value.wallet.closePicker} />
      <MomentCard moment={value.momentNow} onDone={value.clearMoment} />
    </Ctx.Provider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  // no adapters listed: every wallet-standard wallet (phantom, solflare, backpack…) registers itself
  const wallets = useMemo(() => [], []);
  return (
    // a keyless public endpoint; nothing in the browser sends transactions or holds an rpc key
    <ConnectionProvider endpoint="https://solana-rpc.publicnode.com">
      <WalletProvider wallets={wallets} autoConnect onError={(e) => onWalletError?.(e)}>
        <Store>{children}</Store>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export { WalletReadyState };
