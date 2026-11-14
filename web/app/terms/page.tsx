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
            baghedge lets you pick a hedge price and a stop price for a coin you hold. While the price sits between the two, a short runs on
            Hyperliquid, sized to what your linked wallets hold. Your coins stay in your own wallets. We read their public balances and never
            ask for the keys to them.
          </p>
          <p>
            Your margin sits in a Hyperliquid account owned by the coldhedge.near contract on NEAR. A guard program running in an OutLayer
            enclave holds the only key that can trade on that account, and that key can&apos;t withdraw. The contract only signs withdrawals
            back to you.
          </p>

          <h2>Who can use it</h2>
          <p>
            You need to be at least 18 and able to enter a contract where you live. You can&apos;t use baghedge if you&apos;re in a sanctioned
            country, on a sanctions list, or somewhere Hyperliquid doesn&apos;t serve. You&apos;re responsible for following the laws that apply to
            you, including tax.
          </p>

          <h2>Your part</h2>
          <ul>
            <li>You choose the coin, the hedge price, the stop price and the size. We carry out what you set, we don&apos;t pick it for you.</li>
            <li>You keep your login and your wallets safe. Anyone with your login can change your hedges.</li>
            <li>You don&apos;t use baghedge to break the law, attack the service, or trade on someone else&apos;s behalf without their permission.</li>
          </ul>

          <h2>Fees</h2>
          <p>
            Any fee we charge is shown before you confirm a hedge. Hyperliquid, NEAR, 1Click and the chains you pay from charge their own fees,
            and those are separate from ours.
          </p>

          <h2>Risk</h2>
          <p>
            Perpetual futures can lose money. A hedge can fill past your line, funding can turn against you, and Hyperliquid can close a short
            early. Read the <Link href="/disclaimer">disclaimer</Link> before you use it. Nothing on baghedge is financial, tax or legal advice.
          </p>

          <h2>Other services</h2>
          <p>
            baghedge runs on services we don&apos;t control: Privy for login, Hyperliquid for the short, NEAR and its contract for ownership,
            1Click for moving USDC, and OutLayer for the enclave. Their terms apply to you too, and we aren&apos;t responsible when they go down or
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
