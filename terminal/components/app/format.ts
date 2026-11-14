// numbers, colours and market helpers shared by every page. numbers here are for display only (AGENTS.md rule 1)
export const CORAL = "#f0645a";
export const INK = "#0b0908";
export const UP = "#3ecf8e";
export const DOWN = "#f2554b";
export const TAKER = 0.00045;

export const usd = (n: number, d?: number) => {
  const f = d ?? (n !== 0 && Math.abs(n) < 1 ? 4 : 2);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: f, maximumFractionDigits: f })}`;
};
export const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(2)}%`;
export const compact = (n: number) => `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;
export const tone = (n: number | undefined) => (n === undefined ? undefined : n < 0 ? DOWN : UP);
export const time = (t: number) => new Date(t).toLocaleTimeString("en-GB");

// the sidebar's list, and the logos we ship. other coins use hyperliquid's own coin icons
export const COINS = ["SOL", "BTC", "ETH", "HYPE", "XRP", "DOGE", "SUI", "AVAX", "LINK", "BNB"];
const LOCAL: Record<string, string> = { HYPE: "/tokens/HYPE.jpg", NEAR: "/tokens/NEAR.jpg" };
const SHIPPED = new Set(["SOL", "BTC", "ETH", "XRP", "DOGE", "SUI", "AVAX", "LINK", "BNB"]);
export const logo = (c: string) => LOCAL[c] ?? (SHIPPED.has(c) ? `/tokens/${c}.png` : `https://app.hyperliquid.xyz/coins/${c}.svg`);
// hyperliquid perp prices: at most 5 significant figures and at most 6 − szDecimals decimals (AGENTS.md rule 3)
export function priceDecimals(px: number, szDecimals: number) {
  const sig = px >= 1 ? 5 - (Math.floor(Math.log10(px)) + 1) : 5 - Math.floor(Math.log10(px)) - 1;
  return Math.max(0, Math.min(6 - szDecimals, sig));
}
export const coinHref =(c: string) => (c === "SOL" ? "/" : `/markets/${c}`);

// section 23 of the brief: efficient margin is gap + maintenance × (1 + gap) of notional, plus a buffer, here 5%.
// liquidation for a short is where loss plus maintenance eats the margin
export function risk(q: number, entry: number, recovery: number, maxLev: number) {
  const mm = 1 / (2 * maxLev),
    gap = recovery / entry - 1,
    notional = q * entry;
  const margin = notional * (gap + mm * (1 + gap) + 0.05);
  const liq = q > 0 ? (margin / q + entry) / (1 + mm) : 0;
  const fees = notional * TAKER * 2 + 1;
  return { margin, liq, fees, notional };
}
