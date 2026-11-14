import { Suspense } from "react";
import { Providers } from "@/components/app/store";
import { Shell } from "@/components/shell";

// one shell for every page, so the wallet, live prices and the hedge carry across navigation
export default function TerminalLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<div className="h-svh bg-[#0b0908]" />}>
      <Providers>
        <Shell>{children}</Shell>
      </Providers>
    </Suspense>
  );
}
