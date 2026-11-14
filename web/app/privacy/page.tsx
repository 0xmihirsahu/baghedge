import type { Metadata } from "next";
import { Footer } from "@/components/footer";
import { Legal } from "@/components/legal";
import { X_URL } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy policy | baghedge" };

export default function Page() {
  return (
    <>
      <main>
        <Legal
          title="Privacy policy"
          intro="We keep as little as we can. This page says what we keep, why, and who else sees it."
        >
          <h2>What we keep</h2>
          <ul>
            <li>Your login. Privy handles sign in with Google or email and gives us your account ID and email.</li>
            <li>The wallet Privy makes for you, which signs things like arming a hedge or withdrawing.</li>
            <li>The public wallet addresses you link, so we can read what you hold.</li>
            <li>Your hedges: the coins, prices, sizes and history.</li>
            <li>Basic technical logs from our hosting, like IP address and browser, kept for security and debugging.</li>
          </ul>

          <h2>What&apos;s public anyway</h2>
          <p>
            Blockchains are public. Your linked wallets, the hedge account on Hyperliquid, its trades, and the transactions on NEAR and the
            chains you pay from can be seen by anyone. Linking a wallet to baghedge doesn&apos;t make it public, it already is.
          </p>

          <h2>What we use it for</h2>
          <p>
            Running your hedges, showing your holdings and positions, sending the alerts you turn on, and fixing what breaks. We don&apos;t sell
            your data and we don&apos;t run ad tracking.
          </p>

          <h2>Who else sees it</h2>
          <p>
            Privy for login, Hyperliquid, NEAR, 1Click and OutLayer to run the hedge, and our hosting provider. Each handles data under its own
            policy.
          </p>

          <h2>Keeping and deleting</h2>
          <p>
            We keep your data while your account is open. Ask us and we&apos;ll delete what we hold. What&apos;s been written to a blockchain
            can&apos;t be deleted by anyone.
          </p>

          <h2>Changes</h2>
          <p>If we change this policy in a way that matters, we&apos;ll say so in the app first.</p>

          <h2>Talk to us</h2>
          <p>
            Privacy questions and deletion requests go to us on <a href={X_URL}>X</a>.
          </p>
        </Legal>
      </main>
      <Footer />
    </>
  );
}
