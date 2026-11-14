import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/footer";
import { Legal } from "@/components/legal";
import { X_URL } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of use | baghedge" };

export default function Page() {
  return (
    <>
      <main>
        <Legal
          title="Terms of use"
          intro="These terms cover your use of baghedge, the website and the app. By using it you agree to them. They're written to be read, so please read them."
        >
          <h2>What baghedge does</h2>
          <p>
            baghedge is a trading terminal for Hyperliquid. You can search markets, read candles, place orders and manage positions from
            your own Trade account.
          </p>
          <p>
            Wallet Hedge lets you set a rule for SOL you hold in Phantom: a cap, an entry price, a recovery price and an end time. If the
            perp mark crosses down through the entry, a short up to your cap opens in a separate Hedge account, also your own. It tries to
            close on recovery, at the end time, or when you ask. Each rule runs once. Your SOL stays in your wallet. We read its public
            balance and never ask for its keys.
          </p>
          <p>
            A worker we run watches the mark and your wallet. A named, expiring key held in an OutLayer enclave signs only the hedge actions
            your signed rule allows. You keep owner access to both Hyperliquid accounts.
          </p>

          <h2>Who can use it</h2>
          <p>
            You need to be at least 18 and able to enter a contract where you live. You can&apos;t use baghedge if you&apos;re in a sanctioned
            country, on a sanctions list, or somewhere Hyperliquid doesn&apos;t serve. You&apos;re responsible for following the laws that apply to
            you, including tax.
          </p>

          <h2>Your part</h2>
          <ul>
            <li>You choose the cap, the entry and recovery prices and the end time. We carry out what you sign, we don&apos;t pick it for you.</li>
            <li>You keep your wallets safe. Anyone who controls them can change your rules and move your funds.</li>
            <li>You don&apos;t use baghedge to break the law, attack the service, or trade on someone else&apos;s behalf without their permission.</li>
          </ul>

          <h2>Fees</h2>
          <p>
            Any fee we charge is shown, in dollars, before you sign. Hyperliquid, 1Click and Base charge their own fees, and those are
            separate from ours.
          </p>

          <h2>Risk</h2>
          <p>
            Perpetual futures can lose money. A short can fill worse than your entry or not fill at all, funding can turn against you, and
            Hyperliquid can close a short early. Read the <Link href="/disclaimer">disclaimer</Link> before you use it. Nothing on baghedge is financial, tax or legal advice.
          </p>

          <h2>Other services</h2>
          <p>
            baghedge runs on services we don&apos;t control: Hyperliquid for trading and the short, NEAR Intents 1Click for moving USDC between
            Base and Hyperliquid, OutLayer for the enclave, and the wallets you connect. Their terms apply to you too, and we aren&apos;t responsible when they go down or
            change.
          </p>

          <h2>Changes and availability</h2>
          <p>
            baghedge is new and will change. We may add, change or pause features, and we may update these terms. When the change matters,
            we&apos;ll say so in the app before it applies.
          </p>

          <h2>Liability</h2>
          <p>
            baghedge is provided as it is, without warranties. As far as the law allows, we aren&apos;t liable for losses from market moves,
            fills, funding, auto-deleveraging, outages, or the services above.
          </p>

          <h2>Talk to us</h2>
          <p>
            Questions about these terms go to us on <a href={X_URL}>X</a>.
          </p>
        </Legal>
      </main>
      <Footer />
    </>
  );
}
