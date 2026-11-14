import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { Legal } from "@/components/legal";

export const metadata: Metadata = { title: "Disclaimer | baghedge" };

export default function Page() {
  return (
    <>
      <main>
        <Legal
          title="Disclaimer"
          intro="baghedge is a hedge, not insurance. It lowers how much a fall costs you, it doesn't remove the risk. Here's where it can fall short."
        >
          <h2>Not advice</h2>
          <p>Nothing on this site or in the app is financial, tax or legal advice. You decide what to hedge and when.</p>

          <h2>Fast drops fill past your line</h2>
          <p>
            The short opens when the price crosses your hedge price. In a fast market the fill can land well below it, and the part of the fall
            before the fill isn&apos;t covered.
          </p>

          <h2>Every cross costs something</h2>
          <p>
            If the price bounces back and forth across your levels, the short opens and closes each time, and each time pays trading fees.
            Opening a hedge also has fixed costs, about 1.5 USDC a cycle today, so very small hedges don&apos;t make sense.
          </p>

          <h2>Funding can flip</h2>
          <p>
            Funding on Hyperliquid is paid every hour. Usually shorts get paid, but when the perp trades below spot it flips and shorts pay.
          </p>

          <h2>Hyperliquid can close the short early</h2>
          <p>
            In extreme moves Hyperliquid can auto-deleverage, closing profitable positions to cover losing ones. That can close your short in
            the crash you wanted cover for. It happened on 10 October 2025.
          </p>

          <h2>The short can be liquidated</h2>
          <p>
            If the price rallies hard and your margin is thin, the short can be liquidated before it reaches your stop. Safe mode posts more
            margin to make that much less likely.
          </p>

          <h2>Software and other services</h2>
          <p>
            The NEAR contract, the guard in the OutLayer enclave, and the services around them (Privy, Hyperliquid, 1Click, the chains) can have
            bugs, outages or changes we don&apos;t control.
          </p>

          <h2>The numbers on this site</h2>
          <p>
            Prices on this site come from Hyperliquid. The film on the vision page shows what a line 7% under each coin would have kept over the
            last 30 days, before fees, funding and slippage. Past prices don&apos;t predict future ones.
          </p>
        </Legal>
      </main>
      <Footer />
    </>
  );
}
