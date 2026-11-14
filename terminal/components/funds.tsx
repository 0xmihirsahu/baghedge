"use client";

import { ArrowLeft, ArrowUpRight, CaretRight, Check, MagnifyingGlass, X } from "@phosphor-icons/react";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { sendTransaction, switchChain } from "wagmi/actions";
import { BagLoader } from "@/components/motion";
import { haptic } from "@/lib/haptics";
import { CoinLogo } from "./coin-logo";
import { CopyAddress } from "./copy-address";
import { InlineError } from "./inline-error";
import { Tip } from "./tip";
import { evmConfig } from "./app/evm";
import { CORAL, usd } from "./app/format";
import { explorer } from "./app/hl";
import { useStore } from "./app/store";
import {
  FundsError, SOL_ASSET, STEPS, chainName, evmTx, failedState, fromUnits, intentsTx, quote, reportDeposit, sendAssetPayload, sendAssetSubmit,
  solanaTx, sortAssets, sourceKind, stepOf, toFixedTrim, transferStatus, useAssets, type Asset, type Quote, type Status,
} from "./app/funds";

// one sheet for money in and out of the Hyperliquid accounts, same shape as the connect sheet:
// main (account, token, amount, the quote) → tokens (search all of them) → track (each step, with links to check it).
// funding: any listed token, sent from the wallet that holds it (Solana wallet, EVM wallet) or by hand to a deposit
// address. payout: Hyperliquid USDC to any listed token and address, signed by the account with a visible confirm.
type View = "main" | "assets" | "track";
const EASE = [0.25, 1, 0.5, 1] as const;
const DUMMY_SOL = "So11111111111111111111111111111111111111112"; // a valid address, only for dry previews

export function FundsSheet() {
  const { funds, accounts, signers, backend, wallet, evm, toast } = useStore();
  const ask = funds.ask;
  const open = !!ask;
  const [mode, setMode] = useState<"fund" | "payout">("fund");
  const [role, setRole] = useState<"trade" | "hedge">("hedge");
  const [view, setView] = useState<View>("main");
  const [assetId, setAssetId] = useState(SOL_ASSET);
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Quote | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState<null | "quote" | "sign" | "send">(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<{ quote: Quote; source: { href: string; label: string } | null } | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [max, setMax] = useState<number | null>(null);
  const { list, failed } = useAssets();
  const sol = useWallet();
  const { connection } = useConnection();

  const asset = list?.find((a) => a.assetId === assetId) ?? null;
  const kind = asset ? sourceKind(asset) : "solana";
  const venue = accounts[role];
  const signer = signers[role];
  const mainnet = backend.reachable && backend.mode === "mainnet" && backend.apiMode === "mainnet";
  const fund = mode === "fund";

  // every open starts fresh, on what was asked for
  useEffect(() => {
    if (!ask) return;
    const t = setTimeout(() => {
      setMode(ask.mode);
      setRole(ask.role);
      setView("main");
      setAmount(ask.amount ? String(Math.ceil(ask.amount * 100) / 100) : "");
      setError(null);
      setLive(null);
      setStatus(null);
      setSearch("");
    }, 0);
    return () => clearTimeout(t);
  }, [ask]);

  // the external side: where funds come from (refunds go back there) or where a payout lands
  const external =
    kind === "solana" ? (fund ? sol.publicKey?.toBase58() ?? "" : address || (wallet.connected ? wallet.address : "") || "") : kind === "evm" ? (fund ? evm.address ?? "" : address || evm.address || "") : address;
  useEffect(() => {
    const t = setTimeout(() => setAddress(""), 0);
    return () => clearTimeout(t);
  }, [assetId, mode]);

  // the payout maximum: usable USDC less 1.2, room for Hyperliquid's 1 USDC send fee (docs/API.md maxPayoutUsdc)
  useEffect(() => {
    if (!open || fund || !venue) return;
    let gone = false;
    fetch(`/api/accounts?trade=${accounts.trade || venue}&hedge=${accounts.hedge || venue}`)
      .then((r) => r.json())
      .then((j) => !gone && setMax(Number(j?.[role]?.maxPayoutUsdc ?? 0)))
      .catch(() => !gone && setMax(null));
    return () => {
      gone = true;
    };
  }, [open, fund, venue, role, accounts.trade, accounts.hedge]);

  // a dry quote while typing, so the fees and what arrives are on screen before anything is signed
  const n = Number(amount) || 0;
  useEffect(() => {
    if (!open || !mainnet || !asset || n <= 0 || !venue) {
      const t = setTimeout(() => setPreview(null), 0);
      return () => clearTimeout(t);
    }
    const base = external || (kind === "solana" ? DUMMY_SOL : kind === "evm" ? venue : "");
    // no address to quote against: drop the last token's quote and error
    if (!base) {
      const t = setTimeout(() => (setPreview(null), setError(null)), 0);
      return () => clearTimeout(t);
    }
    let gone = false;
    const t = setTimeout(() => {
      setPreviewing(true);
      quote({ direction: fund ? "fund" : "withdraw", role, baseAddress: base, venueAddress: venue, amount: amount.trim(), externalAsset: asset.assetId, dry: true })
        .then((q) => !gone && (setPreview(q), setError(null)))
        .catch((e) => !gone && (setPreview(null), setError(e instanceof FundsError ? e.message : "Couldn't get a quote.")))
        .finally(() => !gone && setPreviewing(false));
    }, 600);
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [open, mainnet, asset, n, amount, venue, external, kind, fund, role]);

  // tracking: NEAR Intents status every 4 s until it lands, fails or refunds
  useEffect(() => {
    if (!live?.quote.id || view !== "track") return;
    let gone = false;
    const id = live.quote.id;
    const poll = () =>
      transferStatus(id)
        .then((s) => {
          if (gone) return;
          setStatus(s);
          if (stepOf(s, live.quote.direction) === 3) haptic("success");
        })
        .catch(() => {});
    poll();
    const t = setInterval(() => {
      if (stepOf(status, live.quote.direction) === 3 || failedState(status)) return;
      poll();
    }, 4000);
    return () => {
      gone = true;
      clearInterval(t);
    };
  }, [live, view, status]);

  const go = async () => {
    if (!asset || !venue) return;
    setError(null);
    haptic("tap");
    try {
      setBusy("quote");
      if (fund) {
        if (!external) throw new FundsError("no_source", kind === "manual" ? `Paste your ${chainName(asset.blockchain)} address. Refunds go there.` : "Connect the wallet that holds it.");
        const q = await quote({ direction: "fund", role, baseAddress: external, venueAddress: venue, amount: amount.trim(), externalAsset: asset.assetId, dry: false });
        const t = q.transfer;
        if (!t || !q.depositAddress) throw new FundsError("no_transfer", "NEAR Intents didn't give a deposit address. Try again.");
        let source: { href: string; label: string } | null = null;
        if (t.type === "solanaTransfer") {
          if (!sol.publicKey) throw new FundsError("no_source", "Connect the Solana wallet that holds it.");
          setBusy("send");
          const from = sol.publicKey;
          const to = new PublicKey(t.to);
          const tx = new Transaction();
          if (!t.mint) tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: BigInt(t.amount) }));
          else {
            // an SPL token: the deposit address's token account is made if it's missing, then a checked transfer
            const mint = new PublicKey(t.mint);
            const program = (await connection.getAccountInfo(mint))?.owner;
            if (!program) throw new FundsError("no_mint", "Couldn't read that token on Solana.");
            const src = getAssociatedTokenAddressSync(mint, from, false, program);
            const dst = getAssociatedTokenAddressSync(mint, to, true, program);
            tx.add(createAssociatedTokenAccountIdempotentInstruction(from, dst, to, mint, program), createTransferCheckedInstruction(src, mint, dst, from, BigInt(t.amount), t.decimals, [], program));
          }
          const sig = await sol.sendTransaction(tx, connection);
          source = { href: solanaTx(sig), label: "Solana transaction" };
        } else if (t.type === "evmErc20Transfer" || t.type === "baseErc20Transfer" || t.type === "evmNativeTransfer") {
          if (!evm.address) throw new FundsError("no_source", "Connect the EVM wallet that holds it.");
          setBusy("send");
          await switchChain(evmConfig, { chainId: t.chainId as (typeof evmConfig)["chains"][number]["id"] }).catch(() => {
            throw new FundsError("chain", `Switch your wallet to ${chainName(asset.blockchain)} and try again.`);
          });
          const send = sendTransaction as unknown as (c: typeof evmConfig, p: Record<string, unknown>) => Promise<`0x${string}`>;
          const hash =
            t.type === "evmNativeTransfer"
              ? await send(evmConfig, { account: evm.address, chainId: t.chainId, to: t.to, value: BigInt(t.value) })
              : await send(evmConfig, { account: evm.address, chainId: t.chainId, to: t.contract, data: t.data, value: BigInt(0) });
          if (q.id) reportDeposit(q.id, hash);
          source = { href: evmTx(t.chainId, hash), label: `${chainName(asset.blockchain)} transaction` };
        }
        // a "deposit" transfer (other chains) is sent by hand: the track view shows the address, amount and memo
        setLive({ quote: q, source });
        toast("Funding", source ? "Sent. Tracking it" : "Send it to the deposit address", "info", source?.href);
      } else {
        if (!signer) throw new FundsError("no_signer", "Sign in to pay out.");
        if (!external) throw new FundsError("no_destination", `Paste the ${chainName(asset.blockchain)} address to send to.`);
        if (max !== null && n > max) throw new FundsError("too_much", `You can send up to ${usd(max, 2)}. 1.2 USDC stays for Hyperliquid's fee.`);
        const q = await quote({ direction: "withdraw", role, baseAddress: external, venueAddress: venue, amount: amount.trim(), externalAsset: asset.assetId, dry: false });
        if (!q.id) throw new FundsError("no_transfer", "NEAR Intents didn't take the payout. Try again.");
        setBusy("sign");
        const p = await sendAssetPayload(q.id, signer.chainId());
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { EIP712Domain, ...types } = p.typedData.types;
        let signature: string;
        try {
          // no wallet popup: this sheet is the confirm, it shows the exact amount and destination before Send
          signature = await signer.typed(venue, { domain: p.typedData.domain, types, primaryType: p.typedData.primaryType, message: p.typedData.message });
        } catch {
          throw new FundsError("rejected", "You cancelled the signature.");
        }
        setBusy("send");
        await sendAssetSubmit(q.id, p.action, signature);
        setLive({ quote: q, source: { href: explorer("address", venue), label: "Hyperliquid account" } });
        toast("Payout", "Sent. Tracking it", "info", explorer("address", venue));
      }
      haptic("success");
      setView("track");
    } catch (e) {
      haptic("error");
      setError(e instanceof FundsError ? e.message : /reject|denied|cancel/i.test(String((e as Error)?.message)) ? "You cancelled it in your wallet." : "Something went wrong. Nothing was sent.");
    } finally {
      setBusy(null);
    }
  };

  // the sheet's height follows its content
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (view === "assets") setView("main");
      else funds.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, view, funds]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortAssets(list ?? []).filter((a) => !q || a.symbol.toLowerCase().includes(q) || chainName(a.blockchain).toLowerCase().includes(q));
  }, [list, search]);

  const outN = preview ? fromUnits(preview.amountOut, preview.destinationDecimals) : 0;
  const minN = preview ? fromUnits(preview.minAmountOut, preview.destinationDecimals) : 0;
  const inUsd = fund ? n * (asset?.priceUsd ?? 0) : n;
  const outUsd = fund ? outN : outN * (asset?.priceUsd ?? 0);
  const step = stepOf(status, live?.quote.direction ?? "fund");
  const failedText = failedState(status);
  const title = view === "assets" ? (fund ? "Pay with" : "Receive as") : view === "track" ? (fund ? "Funding" : "Payout") : fund ? "Add funds" : "Pay out";

  return (
    <div className={`fixed inset-0 z-[65] grid place-items-end bg-black/70 transition-opacity duration-200 sm:place-items-center ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={() => funds.close()} aria-hidden={!open}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full overflow-hidden rounded-t-[28px] bg-[#141312] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] sm:w-[420px] sm:rounded-[28px] ${open ? "translate-y-0 sm:scale-100" : "translate-y-full sm:translate-y-0 sm:scale-95"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <motion.div animate={{ height }} transition={{ duration: 0.27, ease: EASE }}>
          <div ref={inner} className="p-5 sm:p-6">
            <div className="flex items-center justify-between">
              {view === "assets" ? (
                <button onClick={() => setView("main")} className="grid size-9 place-items-center rounded-full bg-[#1c1b1a] text-white/60 transition-colors hover:text-white" aria-label="Back">
                  <ArrowLeft size={16} />
                </button>
              ) : view === "main" ? (
                <div className="grid grid-cols-2 gap-1 rounded-[12px] bg-[#1c1b1a] p-1">
                  {(["fund", "payout"] as const).map((m) => (
                    <button key={m} onClick={() => (haptic("select"), setMode(m), setError(null))} className={`h-7 rounded-[9px] px-3 text-[13px] font-semibold transition-colors duration-150 ${mode === m ? "bg-[#2e2c2a] text-white" : "text-white/45 hover:text-white/70"}`}>
                      {m === "fund" ? "Add" : "Pay out"}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="grid size-9 place-items-center">
                  <BagLoader size={26} color={CORAL} label="baghedge" />
                </span>
              )}
              <button onClick={() => funds.close()} className="grid size-9 place-items-center rounded-full bg-[#1c1b1a] text-white/60 transition-colors hover:text-white" aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={view} initial={{ opacity: 0, y: 8, filter: "blur(2px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -6, filter: "blur(2px)" }} transition={{ duration: 0.2, ease: EASE }}>
                <p className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">{title}</p>

                {view === "main" && !backend.reachable && <p className="mt-1 text-[14px] text-white/45">Couldn&apos;t reach baghedge. It&apos;s retrying; try again in a moment.</p>}
                {view === "main" && backend.reachable && !mainnet && (
                  <>
                    <p className="mt-1 text-[14px] text-white/45">{fund ? "Funding runs on mainnet: NEAR Intents has no testnet. Get test USDC from Hyperliquid's faucet instead." : "Payouts run on mainnet: NEAR Intents has no testnet."}</p>
                    {fund && (
                      <a href="https://app.hyperliquid-testnet.xyz/drip" target="_blank" rel="noreferrer" className="mt-5 flex h-[52px] items-center justify-center gap-1.5 rounded-[16px] bg-[#f0645a] text-[16px] font-semibold">
                        Get test USDC <ArrowUpRight size={15} />
                      </a>
                    )}
                  </>
                )}

                {view === "main" && mainnet && (
                  <>
                    {/* which account */}
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <p className="text-[13px] text-white/45">{fund ? "To" : "From"} your</p>
                      <div className="grid grid-cols-2 gap-1 rounded-[12px] bg-[#1c1b1a] p-1">
                        {(["trade", "hedge"] as const).map((r) => (
                          <button key={r} onClick={() => (haptic("select"), setRole(r))} className={`h-7 rounded-[9px] px-3 text-[13px] font-semibold transition-colors duration-150 ${role === r ? "bg-[#2e2c2a] text-white" : "text-white/45 hover:text-white/70"}`}>
                            {r === "trade" ? "Trade" : "Hedge"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* amount, in the token (funding) or USDC (payout) */}
                    <div className="mt-4 rounded-[16px] bg-[#1c1b1a] p-4">
                      <div className="flex items-center gap-3">
                        <input
                          value={amount}
                          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
                          inputMode="decimal"
                          placeholder="0"
                          aria-label="Amount"
                          className="min-w-0 flex-1 bg-transparent text-[34px] font-semibold leading-none tracking-[-0.03em] tabular-nums outline-none placeholder:text-white/25"
                        />
                        {fund ? (
                          <button onClick={() => (haptic("tap"), setView("assets"))} className="flex h-10 shrink-0 items-center gap-2 rounded-[12px] bg-[#2e2c2a] pl-1.5 pr-2.5 text-[14px] font-semibold transition-colors hover:bg-[#3a3735]">
                            <CoinLogo coin={asset?.symbol ?? "SOL"} className="size-7" />
                            {asset?.symbol ?? "SOL"}
                            <CaretRight size={13} className="text-white/45" />
                          </button>
                        ) : (
                          <span className="flex h-10 shrink-0 items-center gap-2 rounded-[12px] bg-[#2e2c2a] pl-1.5 pr-3 text-[14px] font-semibold">
                            <CoinLogo coin="USDC" className="size-7" />
                            USDC
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[12px] text-white/45 tabular-nums">
                        <span>{n > 0 ? `≈ ${usd(inUsd, 2)}` : fund ? `on ${chainName(asset?.blockchain ?? "sol")}` : "Hyperliquid USDC"}</span>
                        {!fund && max !== null && (
                          <button onClick={() => (haptic("tap"), setAmount(String(Math.max(0, Math.floor(max * 100) / 100))))} className="font-semibold text-white/70 hover:text-white">
                            Max {usd(Math.max(0, max), 2)}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* payout: what it arrives as, and where */}
                    {!fund && (
                      <button onClick={() => (haptic("tap"), setView("assets"))} className="mt-2 flex h-14 w-full items-center gap-3 rounded-[16px] bg-[#1c1b1a] px-3 text-left transition-colors hover:bg-[#232120]">
                        <CoinLogo coin={asset?.symbol ?? "SOL"} className="size-8" />
                        <span className="leading-tight">
                          <span className="block text-[14px] font-semibold">Receive {asset?.symbol ?? "SOL"}</span>
                          <span className="block text-[12px] text-white/45">on {chainName(asset?.blockchain ?? "sol")}</span>
                        </span>
                        <CaretRight size={14} className="ml-auto text-white/35" />
                      </button>
                    )}

                    {/* the external wallet: connected (funding from Solana or EVM), or an address to paste */}
                    <Source fund={fund} kind={kind} asset={asset} external={external} address={address} setAddress={setAddress} />

                    {/* the quote: what's sent, what lands, every fee. estimates until it lands */}
                    <div className="mt-4 min-h-[118px] space-y-2 text-[13px]">
                      {preview ? (
                        <>
                          <Line k={fund ? "You get" : "They get"} tip="After every fee. At least the minimum arrives, or it refunds." v={`≈ ${toFixedTrim(outN, fund ? 2 : 6)} ${fund ? "USDC" : asset?.symbol}`} sub={`min ${toFixedTrim(minN, fund ? 2 : 6)}`} />
                          <Line k="Route fee" tip="NEAR Intents' spread and fees, taken from the amount." v={usd(Math.max(0, inUsd - outUsd - (fund ? 0 : 1)), 2)} />
                          {fund ? <Line k="New account" tip="Hyperliquid takes 1 USDC from the first deposit into a new account." v="1 USDC, first deposit only" /> : <Line k="Hyperliquid fee" tip="Hyperliquid charges 1 USDC to send out." v="1 USDC" />}
                          <Line k="Arrives in" v={preview.timeEstimate ? `about ${Math.max(1, Math.round(preview.timeEstimate / 60))} min` : "a few minutes"} />
                        </>
                      ) : (
                        <p className="pt-1 text-white/40">{previewing ? "Getting a quote…" : n > 0 ? (kind === "manual" && !address ? `Paste your ${chainName(asset?.blockchain ?? "")} address to see the quote.` : "") : "Enter an amount to see the fees."}</p>
                      )}
                    </div>

                    <InlineError text={error} align="center" className="mt-1" />
                    <button
                      disabled={!!busy || !preview || !venue}
                      onClick={go}
                      className="mt-3 flex h-[52px] w-full items-center justify-center gap-2 rounded-[16px] bg-[#f0645a] text-[16px] font-semibold transition-transform duration-150 active:scale-[0.98] disabled:bg-[#1c1b1a] disabled:text-white/50"
                    >
                      {busy && <BagLoader size={18} color={CORAL} glyph="#ffffff" label="Working" />}
                      {!venue
                        ? `Add your ${role === "trade" ? "Trade" : "Hedge"} account first`
                        : busy === "quote"
                          ? "Confirming the quote"
                          : busy === "sign"
                            ? "Signing"
                            : busy === "send"
                              ? fund && kind !== "manual"
                                ? "Approve in your wallet"
                                : "Sending"
                              : fund
                                ? kind === "manual"
                                  ? "Get the deposit address"
                                  : `Add to ${role === "trade" ? "Trade" : "Hedge"}`
                                : `Send ${n > 0 ? usd(n, 2) : ""}`.trim()}
                    </button>
                    <p className="mt-2 text-center text-[12px] text-white/40">Routed by NEAR Intents · estimates until it lands</p>
                  </>
                )}

                {view === "assets" && (
                  <>
                    <div className="mt-4 flex h-12 items-center gap-2 rounded-[14px] bg-[#1c1b1a] px-3 ring-1 ring-transparent focus-within:ring-white/15">
                      <MagnifyingGlass size={16} className="text-white/40" />
                      <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Token or chain" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-white/35" />
                    </div>
                    <div className="-mx-2 mt-3 max-h-[52vh] overflow-y-auto">
                      {failed && <p className="px-3 py-6 text-center text-[13px] text-white/45">Couldn&apos;t load the token list. Close and try again.</p>}
                      {!list && !failed && <div className="grid place-items-center py-8"><BagLoader size={26} color={CORAL} label="Loading tokens" /></div>}
                      {shown.map((a) => (
                        <button
                          key={a.assetId}
                          onClick={() => {
                            haptic("select");
                            setAssetId(a.assetId);
                            setView("main");
                          }}
                          className="flex h-14 w-full items-center gap-3 rounded-[14px] px-2 text-left transition-colors hover:bg-[#1c1b1a]"
                        >
                          <CoinLogo coin={a.symbol} className="size-8" />
                          <span className="min-w-0 leading-tight">
                            <span className="block truncate text-[15px] font-semibold">{a.symbol}</span>
                            <span className="block text-[12px] text-white/45">{chainName(a.blockchain)}</span>
                          </span>
                          <span className="ml-auto flex items-center gap-2 text-[13px] text-white/45 tabular-nums">
                            {a.priceUsd ? usd(a.priceUsd, a.priceUsd < 1 ? 4 : 2) : ""}
                            {a.assetId === assetId && <Check size={14} weight="bold" className="text-white" />}
                          </span>
                        </button>
                      ))}
                      {list && !shown.length && <p className="px-3 py-6 text-center text-[13px] text-white/45">No token matches that.</p>}
                    </div>
                  </>
                )}

                {view === "track" && live && (
                  <>
                    <p className="mt-1 text-[14px] text-white/45 tabular-nums">
                      {toFixedTrim(fromUnits(live.quote.amountIn, live.quote.originDecimals), 6)} {fund ? live.quote.externalAsset.symbol : "USDC"} → ≈ {toFixedTrim(fromUnits(live.quote.amountOut, live.quote.destinationDecimals), fund ? 2 : 6)}{" "}
                      {fund ? "USDC" : live.quote.externalAsset.symbol}
                    </p>

                    {/* a hand-sent deposit: exactly where and how much */}
                    {live.quote.transfer?.type === "deposit" && step === 0 && (
                      <div className="mt-4 space-y-2 rounded-[16px] bg-[#1c1b1a] p-4 text-[13px]">
                        <p className="text-white/55">Send exactly this from your {chainName(live.quote.externalAsset.blockchain)} wallet:</p>
                        <p className="text-[18px] font-semibold tabular-nums">
                          {toFixedTrim(fromUnits(live.quote.transfer.amount, live.quote.originDecimals), 8)} {live.quote.externalAsset.symbol}
                        </p>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white/45">To</span>
                          <CopyAddress address={live.quote.transfer.to} />
                        </div>
                        {live.quote.transfer.memo && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-white/45">Memo (required)</span>
                            <CopyAddress address={live.quote.transfer.memo} />
                          </div>
                        )}
                        {live.quote.deadline && <p className="text-white/40">Send before {new Date(live.quote.deadline).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}, or it refunds.</p>}
                      </div>
                    )}

                    <ol className="mt-5 space-y-3">
                      {STEPS.map((s, i) => {
                        const done = i < step || step === 3;
                        const now = i === step && step < 3 && !failedText;
                        return (
                          <li key={s} className="flex items-center gap-3 text-[14px]">
                            <span className="grid size-6 shrink-0 place-items-center rounded-full" style={{ background: done ? CORAL : "#1c1b1a" }}>
                              {done ? <Check size={12} weight="bold" /> : now ? <BagLoader size={14} color={CORAL} label={s} /> : null}
                            </span>
                            <span className={done || now ? "text-white" : "text-white/40"}>{i === 3 ? (fund ? "Credited" : "Sent") : s}</span>
                          </li>
                        );
                      })}
                    </ol>
                    {failedText && <p className="mt-3 text-[13px] text-[#f2554b]">{failedText}</p>}

                    {/* every place it can be checked */}
                    <div className="mt-5 flex flex-col gap-1">
                      {live.source && <Link href={live.source.href} label={live.source.label} />}
                      {live.quote.depositAddress && <Link href={intentsTx(live.quote.depositAddress)} label="NEAR Intents transfer" />}
                      {(status?.swapDetails?.destinationChainTxHashes ?? []).map((h) => h.explorerUrl && <Link key={h.hash} href={h.explorerUrl} label={`${fund ? "Hyperliquid" : chainName(live.quote.externalAsset.blockchain)} transaction`} />)}
                      {fund && step === 3 && <Link href={explorer("address", venue)} label={`${role === "trade" ? "Trade" : "Hedge"} account on Hyperliquid`} />}
                    </div>

                    <button onClick={() => funds.close()} className="mt-5 h-[52px] w-full rounded-[16px] bg-[#1c1b1a] text-[16px] font-semibold transition-colors hover:bg-[#2e2c2a]">
                      {step === 3 || failedText ? "Done" : "Close. It keeps going"}
                    </button>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// the wallet on the token's chain
function Source({ fund, kind, asset, external, address, setAddress }: { fund: boolean; kind: string; asset: Asset | null; external: string; address: string; setAddress: (v: string) => void }) {
  const { wallet, evm } = useStore();
  const chain = chainName(asset?.blockchain ?? "sol");
  if (fund && kind === "solana")
    return external ? (
      <Row label="From" value={<CopyAddress address={external} />} />
    ) : (
      <button onClick={() => (haptic("tap"), wallet.connect())} className="mt-2 flex h-12 w-full items-center justify-center rounded-[14px] bg-[#1c1b1a] text-[14px] font-semibold text-white/80 transition-colors hover:bg-[#232120] hover:text-white">
        Connect the Solana wallet that holds it
      </button>
    );
  if (fund && kind === "evm")
    return external ? (
      <Row label="From" value={<CopyAddress address={external} />} />
    ) : (
      <button onClick={() => (haptic("tap"), evm.connect(`Connect your ${chain} wallet`, () => {}))} className="mt-2 flex h-12 w-full items-center justify-center rounded-[14px] bg-[#1c1b1a] text-[14px] font-semibold text-white/80 transition-colors hover:bg-[#232120] hover:text-white">
        Connect the {chain} wallet that holds it
      </button>
    );
  return (
    <div className="mt-2 flex h-12 items-center gap-2 rounded-[14px] bg-[#1c1b1a] px-3 ring-1 ring-transparent focus-within:ring-white/15">
      <span className="shrink-0 text-[13px] text-white/45">{fund ? "Refund to" : "To"}</span>
      <input
        value={address || (!fund ? external : "")}
        onChange={(e) => setAddress(e.target.value.trim())}
        placeholder={`Your ${chain} address`}
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-right text-[13px] tabular-nums outline-none placeholder:text-white/30"
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="mt-2 flex h-12 items-center justify-between rounded-[14px] bg-[#1c1b1a] px-3 text-[13px]">
      <span className="text-white/45">{label}</span>
      {value}
    </div>
  );
}

function Line({ k, v, sub, tip }: { k: string; v: string; sub?: string; tip?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-white/45">{tip ? <Tip text={tip} align="start">{k}</Tip> : k}</span>
      <span className="text-right font-semibold tabular-nums">
        {v}
        {sub && <span className="ml-1.5 font-normal text-white/40">{sub}</span>}
      </span>
    </div>
  );
}

function Link({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex h-10 items-center justify-between rounded-[12px] px-3 text-[13px] font-semibold text-white/75 transition-colors hover:bg-[#1c1b1a] hover:text-white">
      {label}
      <ArrowUpRight size={14} />
    </a>
  );
}
