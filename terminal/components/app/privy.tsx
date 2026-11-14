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

  // the embedded wallets by HD index, read from the user's linked accounts (wallet objects don't carry the index)
  const embedded = useMemo(() => {
    const out: Record<number, string> = {};
    for (const a of user?.linkedAccounts ?? []) {
      const w = a as { type?: string; walletClientType?: string; chainType?: string; walletIndex?: number | null; address?: string };
      if (w.type === "wallet" && w.walletClientType === "privy" && w.chainType === "ethereum" && typeof w.walletIndex === "number" && w.address) out[w.walletIndex] = w.address;
    }
    return out;
  }, [user]);

  // index 0 comes with the login; index 1 (Hedge) is made once, right after
  useEffect(() => {
    if (!ready || !authenticated || asked.current || creating) return;
    if (embedded[0] && embedded[1]) return;
    asked.current = true;
    const t = setTimeout(async () => {
      setCreating(true);
      setError(null);
      try {
        if (!embedded[0]) await createWallet({ walletIndex: 0 });
        if (!embedded[1]) await createWallet({ walletIndex: 1 });
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
        asked.current = false;
      } finally {
        setCreating(false);
      }
    }, 0);
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
        embeddedWallets: { ethereum: { createOnLogin: "all-users" }, showWalletUIs: false },
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
