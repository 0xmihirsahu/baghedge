import { describe, expect, test } from "bun:test";
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { agentFor, createGuardSigner, createGuardSignerFor, GuardRefused, type MultiOwnerExecutor, type OutLayerExecutor } from "../server/guard";

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

describe("OutLayer per-owner agent binding", () => {
  const owner = "0x11111111111111111111111111111111111111aB";
  const normalizedOwner = "0x11111111111111111111111111111111111111ab";
  const other = "0x2222222222222222222222222222222222222222";
  const txHash = "2oDKos4BKHkQXERKVKUUqiRD1DmsQnctVvHoaUBk7buA";
  const key = privateKeyToAccount(`0x${"01".repeat(32)}`);
  const publicKey: Hex = `0x${key.publicKey.slice(4)}`;
  const ownerAgent: Hex = `0x${keccak256(publicKey).slice(-40)}`;

  test("returns a final receipt reference only for the requested owner and matching key", async () => {
    let output = { owner: normalizedOwner as string, address: ownerAgent, publicKey };
    const transport: MultiOwnerExecutor = {
      buildHash, environment, run: async () => { throw new Error("not an order"); },
      async discover(request) {
        expect(request.operation).toBe("public_key");
        expect(request.owner).toBe(normalizedOwner);
        return { output, txHash };
      },
    };
    expect(await agentFor(transport, owner)).toEqual({ agentAddress: ownerAgent, attestationTxHash: txHash });
    output = { ...output, owner: other };
    await expect(agentFor(transport, owner)).rejects.toThrow("Invalid OutLayer owner agent response");
    output = { ...output, owner: normalizedOwner, address: other };
    await expect(agentFor(transport, owner)).rejects.toThrow("does not match its public key");
  });

  test("fails closed on a different agent response and rejects equal Trade and Hedge accounts", async () => {
    const policy = { guardAgent: ownerAgent, guardBuildHash: buildHash, environment, hedgeAccount: owner, tradeAccount: other } as const;
    const context = { policy, ownerSig: "0x" as const, chainId: 8453 };
    const transport: MultiOwnerExecutor = {
      buildHash, environment, discover: async () => { throw new Error("not discovery"); },
      async run(request) {
        expect(request.policy).toEqual(policy);
        return { ok: true, agent: other, nonce: request.nonce, expiresAfter: request.expiresAfter, r: buildHash, s: buildHash, v: 27 };
      },
    };
    const now = Date.now();
    await expect(createGuardSignerFor(context, transport).signL1({ type: "order" }, now, now + 5_000))
      .rejects.toThrow("does not match the requested action");
    expect(() => createGuardSignerFor({ ...context, policy: { ...policy, tradeAccount: owner } }, transport))
      .toThrow("Trade and Hedge must be separate accounts");
  });
});
