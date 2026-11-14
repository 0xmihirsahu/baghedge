"use client";

import { PrivyProvider, useCreateWallet, usePrivy, useSignMessage, useSignTypedData } from "@privy-io/react-auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// one sign-in, two embedded EVM wallets: index 0 is Trade, index 1 is Hedge (docs/INTEGRATION.md 0 → Wallets).
// login is email or Google only; Phantom stays the watched SOL wallet through the solana adapter,
// and the terminal's own wagmi connect stays the fallback for people who bring their own EVM wallet
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export type Signer = {
  kind: "privy" | "external";
  message: (address: string, message: string) => Promise<string>;
  typed: (address: string, typedData: Record<string, unknown>) => Promise<string>;
  chainId: () => number;
};

type Bridge = {
  ready: boolean;
  authenticated: boolean;
  label: string | null;
  trade: string | null;
  hedge: string | null;
  creating: boolean;
  error: string | null;
  login: () => void;
  logout: () => Promise<void>;
  retry: () => void;
  signer: Signer;
};

const Ctx = createContext<Bridge | null>(null);
// null when Privy isn't configured: the terminal falls back to external wallets only
export const usePrivyBridge = () => useContext(Ctx);

// silent signatures: our own review screen is the confirm, and it shows the exact values first
const SILENT = { showWalletUIs: false } as const;

function BridgeInner({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signMessage } = useSignMessage();
  const { signTypedData } = useSignTypedData();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(false);

  // the user's embedded EVM wallets in creation order: the first is Trade, the second is Hedge.
  // HD apps carry walletIndex; server-wallet (TEE) apps leave it null, so creation time orders them instead
  const embedded = useMemo(() => {
    type W = { type?: string; walletClientType?: string; chainType?: string; walletIndex?: number | null; address?: string; imported?: boolean; firstVerifiedAt?: Date | string | null; verifiedAt?: Date | string | null };
    const list = ((user?.linkedAccounts ?? []) as W[]).filter((w) => w.type === "wallet" && w.walletClientType === "privy" && w.chainType === "ethereum" && !w.imported && !!w.address);
    const t = (w: W) => new Date(w.firstVerifiedAt ?? w.verifiedAt ?? 0).getTime();
    list.sort((a, b) => (a.walletIndex ?? Infinity) - (b.walletIndex ?? Infinity) || t(a) - t(b));
    return list.map((w) => w.address!);
  }, [user]);

  // right after login: make Trade (first) if missing, then Hedge (an additional wallet), once.
  // a hung call ends in an error, not a spinner
  useEffect(() => {
    if (!ready || !authenticated || asked.current || creating) return;
    if (embedded[0] && embedded[1]) return;
    const run = async () => {
      asked.current = true;
      setCreating(true);
      setError(null);
      const capped = <T,>(p: Promise<T>) => Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error("timed out")), 25_000))]);
      try {
        // an "already has a wallet" refusal just means Trade exists: carry on to Hedge
        if (!embedded[0]) await capped(createWallet()).catch((e) => {
          if (!/already/i.test(String((e as Error)?.message ?? e))) throw e;
        });
        await capped(createWallet({ createAdditional: true }));
      } catch (e) {
        console.error("privy createWallet", e);
        // no retry loop: signing out and in again resets it
        setError(String((e as Error)?.message ?? e));
      } finally {
        setCreating(false);
      }
    };
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [ready, authenticated, embedded, creating, createWallet]);

  const message = useCallback(async (address: string, m: string) => (await signMessage({ message: m }, { address, uiOptions: SILENT })).signature, [signMessage]);
  const typed = useCallback(
    async (address: string, t: Record<string, unknown>) =>
      (await signTypedData(t as unknown as Parameters<typeof signTypedData>[0], { address, uiOptions: SILENT })).signature,
    [signTypedData],
  );

  const label = user?.email?.address ?? user?.google?.email ?? (user?.wallet?.address ? `${user.wallet.address.slice(0, 6)}…${user.wallet.address.slice(-4)}` : null);
  const value: Bridge = {
    ready,
    authenticated,
    label,
    trade: embedded[0] ?? null,
    hedge: embedded[1] ?? null,
    creating,
    error,
    login: () => login(),
    retry: () => {
      asked.current = false;
      setError(null);
    },
    logout: async () => {
      asked.current = false;
      await logout();
    },
    // embedded wallets sign for any chain id; Arbitrum is the one Hyperliquid's own app uses
    signer: { kind: "privy", message, typed, chainId: () => 42161 },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function PrivyWallets({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return <>{children}</>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google"],
        // wallets are made by the bridge after login, in order, so the login modal never waits on them
        embeddedWallets: { ethereum: { createOnLogin: "off" }, showWalletUIs: false },
        appearance: {
          theme: "#141312",
          accentColor: "#f0645a",
          // eslint-disable-next-line @next/next/no-img-element
          logo: <img src="/mascot.webp" alt="baghedge" style={{ height: 56, width: "auto" }} />,
          landingHeader: "Sign in to baghedge",
          loginMessage: "Your Trade and Hedge accounts come with it.",
          walletChainType: "ethereum-only",
        },
      }}
    >
      <BridgeInner>{children}</BridgeInner>
    </PrivyProvider>
  );
}
