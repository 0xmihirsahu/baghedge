"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { arbitrum, avalanche, base, berachain, bsc, gnosis, mainnet, optimism, polygon, scroll } from "wagmi/chains";
import { injected } from "wagmi/connectors/injected";
import { walletConnect } from "wagmi/connectors/walletConnect";

// the EVM side: the Hyperliquid Trade and Hedge owners (and Base funding) sign here, in the user's wallet.
// injected wallets (metamask, rabby…) are found on their own (EIP-6963); phones join over WalletConnect.
// chains are offered, never required: signatures work on whatever chain the wallet approves (docs/INTEGRATION.md),
// only the Base USDC transfer switches to 8453, right before that one transaction
export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "3820d0c2a823fa021803a068e89059b5";

export const evmConfig = createConfig({
  // every EVM chain NEAR Intents funds from, so a wallet can switch to the one its tokens are on
  chains: [base, mainnet, arbitrum, optimism, polygon, bsc, avalanche, gnosis, berachain, scroll],
  connectors: [
    injected({ shimDisconnect: true }),
    walletConnect({
      projectId: WC_PROJECT_ID,
      showQrModal: true,
      metadata: { name: "baghedge", description: "Trade perps. Hedge your bag.", url: "https://app.baghedge.xyz", icons: ["https://app.baghedge.xyz/icon.png"] },
    }),
  ],
  transports: {
    [base.id]: http(), [mainnet.id]: http(), [arbitrum.id]: http(), [optimism.id]: http(), [polygon.id]: http(),
    [bsc.id]: http(), [avalanche.id]: http(), [gnosis.id]: http(), [berachain.id]: http(), [scroll.id]: http(),
  },
  ssr: true,
});

export function EvmProviders({ children }: { children: ReactNode }) {
  const [queries] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={evmConfig}>
      <QueryClientProvider client={queries}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
