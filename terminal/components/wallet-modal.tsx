"use client";

import { ArrowLeft, ArrowUpRight, CaretRight, ClipboardText, Eye, Wallet, X } from "@phosphor-icons/react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BagLoader } from "@/components/motion";
import { haptic } from "@/lib/haptics";
import { InlineError } from "./inline-error";
import { CORAL } from "./app/format";
import { useStore } from "./app/store";

// one sheet that changes shape, family-style: two choices first (connect a wallet, or watch an address),
// then it morphs to the chosen step. the height animates to fit, the content cross-fades, back reverses it.
// solana wallet adapter finds and connects the wallets; this only draws them.
// edge cases: nothing installed (install links), a phone with no wallet (open the app inside one),
// a wallet mid-connect (loader, the rest wait), a rejection (inline under the list), a bad address (red ring, inline line)
type View = "home" | "wallets" | "watch";
const EASE = [0.25, 1, 0.5, 1] as const;

const INSTALL = [
  { name: "Phantom", icon: "/wallets/phantom.svg", bg: "#ab9ff2", pad: "p-1.5", white: true, url: "https://phantom.com/download", open: (u: string) => `https://phantom.app/ul/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(location.origin)}` },
  { name: "Solflare", icon: "/wallets/solflare.svg", bg: "#ffef46", pad: "p-0", white: false, url: "https://solflare.com/download", open: (u: string) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(location.origin)}` },
  { name: "Backpack", icon: "/wallets/backpack.png", bg: "#1c1b1a", pad: "p-1.5", white: false, url: "https://backpack.app/download", open: null },
];

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { wallets, select, wallet, connecting, connected } = useWallet();
  const { wallet: store } = useStore();
  const [view, setView] = useState<View>("home");
  const [picked, setPicked] = useState<string | null>(null);
  const [addr, setAddr] = useState("");
  const [bad, setBad] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [phone, setPhone] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ready = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
  const missing = INSTALL.filter((i) => !ready.some((w) => w.adapter.name === i.name));

  useEffect(() => {
    setTimeout(() => {
      setPhone(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
      setMounted(true);
    }, 0);
  }, []);
  // every open starts on the two choices
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setView("home");
      setAddr("");
      setBad(null);
      setFailed(null);
    }, 0);
    return () => clearTimeout(t);
  }, [open]);
  // close once a wallet is connected; escape steps back, then closes
  useEffect(() => {
    if (open && connected) onClose();
  }, [open, connected, onClose]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (view !== "home") setView("home");
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, view, onClose]);
  // a cancelled connect clears the loader, and says so here, where the user is looking
  const wasConnecting = useRef(false);
  useEffect(() => {
    const was = wasConnecting.current;
    wasConnecting.current = connecting;
    if (connecting || connected) return;
    const t = setTimeout(() => {
      setPicked(null);
      if (was && open) {
        setFailed("Connection cancelled. Pick a wallet to try again.");
        haptic("error");
      }
    }, 0);
    return () => clearTimeout(t);
  }, [connecting, connected, open]);

  // the sheet's height follows its content
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted]);

  const submit = () => {
    if (store.watch(addr)) {
      haptic("success");
      onClose();
    } else {
      haptic("error");
      setBad(/^0x/i.test(addr.trim()) ? "That's an EVM address. Paste a Solana one." : "Not a Solana address. Check it and paste again.");
    }
  };
  const denied = () => {
    haptic("error");
    setBad("Paste is blocked here. Type or long-press to paste.");
  };
  const paste = () => {
    haptic("tap");
    if (!navigator.clipboard?.readText) return denied();
    navigator.clipboard.readText().then((t) => {
      setAddr(t.trim());
      setBad(null);
    }, denied);
  };
  const go = (v: View) => {
    haptic("select");
    setFailed(null);
    setView(v);
  };

  if (!mounted) return null;

  const title = { home: "Connect", wallets: "Connect a wallet", watch: "Watch an address" }[view];

  return (
    <div className={`fixed inset-0 z-[65] grid place-items-end bg-black/70 transition-opacity duration-200 sm:place-items-center ${open ? "opacity-100" : "pointer-events-none opacity-0"}`} onClick={onClose} aria-hidden={!open}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full overflow-hidden rounded-t-[28px] bg-[#141312] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] sm:w-[392px] sm:rounded-[28px] ${open ? "translate-y-0 sm:scale-100" : "translate-y-full sm:translate-y-0 sm:scale-95"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <motion.div animate={{ height }} transition={{ duration: 0.27, ease: EASE }}>
          <div ref={inner} className="p-5 sm:p-6">
            <div className="flex items-center justify-between">
              {view === "home" ? (
                <span className="grid size-9 place-items-center">
                  <BagLoader size={28} color={CORAL} label="baghedge" />
                </span>
              ) : (
                <button onClick={() => go("home")} className="grid size-9 place-items-center rounded-full bg-[#1c1b1a] text-white/60 transition-colors hover:text-white" aria-label="Back">
                  <ArrowLeft size={16} />
                </button>
              )}
              <button onClick={onClose} className="grid size-9 place-items-center rounded-full bg-[#1c1b1a] text-white/60 transition-colors hover:text-white" aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 8, filter: "blur(2px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -6, filter: "blur(2px)" }}
                transition={{ duration: 0.2, ease: EASE }}
              >
                <p className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">{title}</p>

                {view === "home" && (
                  <>
                    <p className="mt-1 text-[14px] text-white/45">See the SOL you&apos;d hedge. Nothing moves without your signature.</p>
                    <div className="mt-5 flex flex-col gap-2">
                      <Choice icon={Wallet} title="Connect a wallet" line="Phantom, Solflare, Backpack" onClick={() => go("wallets")} primary />
                      <Choice icon={Eye} title="Watch an address" line="Read only. Paste any Solana address" onClick={() => go("watch")} />
                    </div>
                  </>
                )}

                {view === "wallets" && (
                  <>
                    <p className="mt-1 text-[14px] text-white/45">{ready.length ? "Pick the wallet that holds your SOL." : phone ? "Open baghedge inside a wallet app." : "Install a Solana wallet to continue."}</p>
                    <div className="mt-5 flex flex-col gap-1">
                      {ready.map((w) => {
                        const busy = connecting && (picked === w.adapter.name || wallet?.adapter.name === w.adapter.name);
                        return (
                          <button
                            key={w.adapter.name}
                            disabled={connecting}
                            onClick={() => {
                              haptic("tap");
                              setFailed(null);
                              setPicked(w.adapter.name);
                              select(w.adapter.name as WalletName);
                            }}
                            className="flex h-14 items-center gap-3 rounded-[16px] px-3 text-left transition-colors duration-150 hover:bg-[#1c1b1a] active:scale-[0.99] disabled:opacity-60 disabled:hover:bg-transparent"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={w.adapter.icon} alt="" className="size-9 rounded-[10px]" />
                            <span className="text-[16px] font-semibold">{w.adapter.name}</span>
                            <span className="ml-auto text-[13px] text-white/45">{busy ? <BagLoader size={18} color={CORAL} label="Connecting" /> : "Detected"}</span>
                          </button>
                        );
                      })}
                      {missing.length > 0 && ready.length > 0 && <p className="mt-2 px-3 text-[12px] text-white/40">More wallets</p>}
                      {missing.map((i) => {
                        const href = phone && i.open ? i.open(location.href) : i.url;
                        return (
                          <a key={i.name} href={href} target={phone ? undefined : "_blank"} rel="noreferrer" onClick={() => haptic("tap")} className="flex h-14 items-center gap-3 rounded-[16px] px-3 transition-colors duration-150 hover:bg-[#1c1b1a]">
                            <span className={`grid size-9 shrink-0 place-items-center overflow-hidden rounded-[10px] ${i.pad}`} style={{ background: i.bg }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={i.icon} alt="" className="size-full object-contain" style={{ filter: i.white ? "brightness(0) invert(1)" : undefined }} />
                            </span>
                            <span className="text-[16px] font-semibold">{i.name}</span>
                            <span className="ml-auto flex items-center gap-1 text-[13px] text-white/45">
                              {phone && i.open ? "Open" : "Install"} <ArrowUpRight size={14} />
                            </span>
                          </a>
                        );
                      })}
                    </div>
                    <InlineError text={failed} align="center" className="mt-2" />
                  </>
                )}

                {view === "watch" && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      submit();
                    }}
                  >
                    <p className="mt-1 text-[14px] text-white/45">Follow any wallet&apos;s SOL without connecting it.</p>
                    <div className={`mt-5 flex h-14 items-center gap-2 rounded-[16px] bg-[#1c1b1a] pl-4 pr-2 ring-1 transition-shadow ${bad ? "ring-[#f2554b]" : "ring-transparent focus-within:ring-white/15"}`}>
                      <input
                        autoFocus
                        value={addr}
                        onChange={(e) => {
                          setAddr(e.target.value);
                          setBad(null);
                        }}
                        placeholder="Solana address"
                        aria-invalid={!!bad}
                        spellCheck={false}
                        className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-white/35"
                      />
                      <button type="button" onClick={paste} className="flex h-9 items-center gap-1.5 rounded-[11px] bg-[#2e2c2a] px-3 text-[13px] font-semibold text-white/80 transition-colors hover:text-white">
                        <ClipboardText size={14} /> Paste
                      </button>
                    </div>
                    <InlineError text={bad} className="mt-2 px-1" />
                    <button className="mt-2 h-[52px] w-full rounded-[16px] bg-[#f0645a] text-[16px] font-semibold transition-transform duration-150 active:scale-[0.98] disabled:bg-[#1c1b1a] disabled:text-white/50" disabled={!addr.trim()}>
                      Watch
                    </button>
                  </form>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// a choice on the first step: tile, title, one line, caret. the main one has a coral tile
function Choice({ icon: Icon, title, line, onClick, primary }: { icon: typeof Wallet; title: string; line: string; onClick: () => void; primary?: boolean }) {
  return (
    <button onClick={onClick} className="group flex items-center gap-3 rounded-[18px] bg-[#1c1b1a] p-3 text-left transition-[background-color,scale] duration-150 hover:bg-[#232120] active:scale-[0.99]">
      <span className="grid size-11 shrink-0 place-items-center rounded-[13px]" style={{ background: primary ? CORAL : "#2e2c2a" }}>
        <Icon size={22} weight="fill" className="text-white" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-[16px] font-semibold">{title}</span>
        <span className="mt-1 block truncate text-[13px] text-white/45">{line}</span>
      </span>
      <CaretRight size={16} className="ml-auto text-white/35 transition-[translate,color] duration-150 group-hover:translate-x-0.5 group-hover:text-white/70" />
    </button>
  );
}
