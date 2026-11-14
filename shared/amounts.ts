export function toUnits(value: string, decimals: number): bigint {
  if (!/^\d{1,24}(\.\d{1,24})?$/.test(value)) throw new Error("Invalid decimal amount");
  const [whole = "0", fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("Amount exceeds asset precision");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export function fromUnits(amount: bigint, decimals: number): string {
  const sign = amount < 0n ? "-" : "";
  const magnitude = amount < 0n ? -amount : amount;
  if (decimals === 0) return sign + magnitude.toString();
  const raw = magnitude.toString().padStart(decimals + 1, "0");
  const fraction = raw.slice(-decimals).replace(/0+$/, "");
  return sign + raw.slice(0, -decimals) + (fraction ? "." + fraction : "");
}

export function isEvmAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[\da-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value);
}

export function isSolanaAddress(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const char of value) n = n * 58n + BigInt(alphabet.indexOf(char));
  const leadingZeros = value.match(/^1*/)?.[0].length ?? 0;
  const bytes = n === 0n ? 0 : Math.ceil(n.toString(16).length / 2);
  return leadingZeros + bytes === 32;
}
