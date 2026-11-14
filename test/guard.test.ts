import { describe, expect, test } from "bun:test";
import { createGuardSigner, GuardRefused, type OutLayerExecutor } from "../server/guard";

const agent = "0x1111111111111111111111111111111111111111";
const buildHash = "0x2222222222222222222222222222222222222222222222222222222222222222";
const environment = "mainnet";

function signer(run: OutLayerExecutor["run"]) {
  return createGuardSigner({ policy: { guardAgent: agent, guardBuildHash: buildHash, environment },
    ownerSig: "0x", chainId: 8453 }, { agent, buildHash, environment, run });
}

describe("OutLayer signer outcomes", () => {
  test("identifies a guard refusal, but leaves an invalid response or transport failure unresolved", async () => {
    const sign = (run: OutLayerExecutor["run"]) => {
      const now = Date.now();
      return signer(run).signL1({ type: "order" }, now, now + 10_000);
    };
    await expect(sign(async () => ({ ok: false, error: "wrong order asset" }))).rejects.toBeInstanceOf(GuardRefused);
    await expect(sign(async () => ({ ok: false }))).rejects.not.toBeInstanceOf(GuardRefused);
    await expect(sign(async () => { throw new Error("RPC timed out"); })).rejects.not.toBeInstanceOf(GuardRefused);
  });
});
