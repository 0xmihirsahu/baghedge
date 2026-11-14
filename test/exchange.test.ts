import { describe, expect, test } from "bun:test";
import { generatePrivateKey } from "viem/accounts";
import { fallbackSigner, parseExchangeResponse, recoverL1Signer, verifiedSigner, type HedgeSigner } from "../server/exchange";

const action = { type: "order", orders: [{ a: 0, b: false, p: "140", s: "0.1", r: false, t: { limit: { tif: "Ioc" } } }], grouping: "na" };
const nonce = 1794666000000;

describe("signing", () => {
  test("recovers the agent from a signature over the documented vector", async () => {
    const signer = fallbackSigner(generatePrivateKey(), "testnet");
    const signature = await signer.signL1(action, nonce, 1794666005000);
    const recovered = await recoverL1Signer("testnet", action, nonce, signature, 1794666005000);
    expect(recovered.address).toBe(signer.address);
    expect(recovered.connectionId).toBe("0x834ba2dace98eccc2436d18abe35f66b07e39a63bfc88b85aa628e4032b70110");
  });

  test("a changed expiry, network or action does not recover the agent", async () => {
    const signer = fallbackSigner(generatePrivateKey(), "testnet");
    const signature = await signer.signL1(action, nonce, 1794666005000);
    expect((await recoverL1Signer("testnet", action, nonce, signature, 1794666005001)).address).not.toBe(signer.address);
    expect((await recoverL1Signer("mainnet", action, nonce, signature, 1794666005000)).address).not.toBe(signer.address);
    const changed = { ...action, grouping: "normalTpsl" };
    expect((await recoverL1Signer("testnet", changed, nonce, signature, 1794666005000)).address).not.toBe(signer.address);
  });

  test("verifiedSigner refuses a signer that signs with a different key", async () => {
    const real = fallbackSigner(generatePrivateKey(), "testnet");
    const impostor: HedgeSigner = { ...fallbackSigner(generatePrivateKey(), "testnet"), address: real.address, kind: "guard" };
    expect(verifiedSigner(real, "testnet").signL1(action, nonce)).resolves.toBeDefined();
    expect(verifiedSigner(impostor, "testnet").signL1(action, nonce)).rejects.toThrow("Signer mismatch");
  });
});

describe("exchange responses", () => {
  test("an HTTP 200 can carry per-order errors and partial fills", () => {
    const result = parseExchangeResponse({ status: "ok", response: { type: "order", data: { statuses: [
      { filled: { oid: 7, totalSz: "0.05", avgPx: "73.1" } }, "waitingForFill", { error: "Order could not immediately match" },
    ] } } });
    expect(result.transport).toBe("acked");
    if (result.transport !== "acked") return;
    expect(result.statuses[0]).toEqual({ kind: "ok", filled: { oid: 7, totalSz: "0.05", avgPx: "73.1" } });
    expect(result.statuses[1]).toEqual({ kind: "ok" });
    expect(result.statuses[2]).toEqual({ kind: "error", message: "Order could not immediately match" });
  });

  test("a top-level err is a rejection, and junk is unknown", () => {
    expect(parseExchangeResponse({ status: "err", response: "User or API Wallet does not exist." }).transport).toBe("rejected");
    expect(parseExchangeResponse("nope").transport).toBe("unknown");
  });
});
