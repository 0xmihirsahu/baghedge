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
          intro="A hedge lowers how much a fall can cost you. It doesn't remove the risk, and it costs money to run. Here's where it can fall short."
        >
          <h2>Not advice</h2>
          <p>Nothing on this site or in the app is financial, tax or legal advice. You decide what to trade, what to hedge and when.</p>

          <h2>The short can fill badly, or not at all</h2>
          <p>
            A short opens when the perp mark crosses down through your entry price. In a fast market it can fill well below your entry, or
            only partly, and the part of the fall before the fill isn&apos;t hedged. If nothing fills inside your limits, there&apos;s no short.
          </p>

          <h2>A rule runs once</h2>
          <p>
            Once the short opens, it tries to close on recovery, at the end time, or when you ask. Then the rule is done. If the price falls
            again, nothing opens until you set a new rule.
          </p>

          <h2>It costs money</h2>
          <p>
            Trades pay Hyperliquid&apos;s fees, moving USDC through 1Click has its own fees, and the review shows every cost in dollars before you
            sign. Small hedges can cost more than they save.
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
            If the price rallies hard and your margin is thin, the short can be liquidated before it reaches your recovery price. The review
            shows the estimated liquidation price before you sign.
          </p>

          <h2>Software and other services</h2>
          <p>
            The worker, the guard in the OutLayer enclave, and the services around them (Hyperliquid, 1Click, Base, your wallets) can have
            bugs, outages or changes we don&apos;t control. A recovery stop confirmed on Hyperliquid can try to close the short if our worker is
            down, but it isn&apos;t certain to.
          </p>

          <h2>The numbers on this site</h2>
          <p>
            Prices on this site come from Hyperliquid. The film on the vision page uses real SOL prices from the last 30 days to
            show the idea of a line under a coin, before fees, funding and slippage. Past prices don&apos;t predict future ones.
          </p>
        </Legal>
      </main>
      <Footer />
    </>
  );
}
