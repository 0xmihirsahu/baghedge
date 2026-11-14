import { expect, test } from "bun:test";
import { ApproveAgentTypes, SendAssetTypes } from "@nktkas/hyperliquid/api/exchange";
import { signUserSignedAction } from "@nktkas/hyperliquid/signing";
import { serializeSignature } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createOwnerActions, userTypedData } from "../server/owner";

const owner = privateKeyToAccount(generatePrivateKey());
const sign = (typedData: ReturnType<typeof userTypedData>) => {
  const { EIP712Domain: _d, ...types } = typedData.types;
  return (owner.signTypedData as (p: unknown) => Promise<`0x${string}`>)({ domain: typedData.domain, types, primaryType: typedData.primaryType, message: typedData.message });
};

test("approveAgent typed data signs identically to the official SDK", async () => {
  const { action, typedData } = createOwnerActions("testnet").approveAgent({ agentAddress: "0x5a272d74b33a28c540116f24433b4fb0c74e0337", chainId: 42161, purpose: "trade" });
  expect(action.agentName).toMatch(/^baghedge-trade valid_until \d{13}$/);
  const sdk = await signUserSignedAction({ wallet: owner, action: action as never, types: ApproveAgentTypes });
  expect(await sign(typedData)).toBe(serializeSignature({ r: sdk.r, s: sdk.s, v: BigInt(sdk.v) }));
});

test("sendAsset typed data signs identically to the official SDK and copies the quote exactly", async () => {
  const transfer = { type: "hypercoreSendAsset", destination: "0x6dee0018d4cc9a4046590b31b121fe888d8b69f4", sourceDex: "", destinationDex: "",
    token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054", amount: "12.5", fromSubAccount: "" };
  const { action, typedData } = createOwnerActions("mainnet").sendAsset(transfer, 8453);
  expect(action).toMatchObject({ destination: transfer.destination, amount: "12.5", hyperliquidChain: "Mainnet", signatureChainId: "0x2105" });
  const sdk = await signUserSignedAction({ wallet: owner, action: action as never, types: SendAssetTypes });
  expect(await sign(typedData)).toBe(serializeSignature({ r: sdk.r, s: sdk.s, v: BigInt(sdk.v) }));
});

test("the relay refuses a wrong signer, an unquoted destination, the wrong network, and other action types", async () => {
  const calls: unknown[] = [];
  const fakeFetch = (async (_u: unknown, init: RequestInit) => { calls.push(JSON.parse(String(init.body))); return Response.json({ status: "ok", response: { type: "default" } }); }) as typeof fetch;
  const actions = createOwnerActions("mainnet", fakeFetch);
  const transfer = { type: "hypercoreSendAsset", destination: "0x6dee0018d4cc9a4046590b31b121fe888d8b69f4", token: "USDC:0x6d1e7cde53ba9467b783cb7c530ce054", amount: "1" };
  const { action, typedData } = actions.sendAsset(transfer, 8453);
  const signature = await sign(typedData);
  const allow = (d: string) => d === transfer.destination;

  const bound = { allowDestination: allow, expectedTransfer: transfer, deadline: new Date(Date.now() + 60_000).toISOString() };
  expect(actions.submit({ action, signature }, { expectedSigner: "0x1111111111111111111111111111111111111111", ...bound })).rejects.toThrow("account owner");
  expect(actions.submit({ action, signature }, { expectedSigner: owner.address, ...bound, allowDestination: () => false })).rejects.toThrow("quoted deposit");
  expect(actions.submit({ action: { ...action, type: "withdraw3" }, signature }, { expectedSigner: owner.address })).rejects.toThrow("Only approveAgent");
  expect(createOwnerActions("testnet", fakeFetch).submit({ action, signature }, { expectedSigner: owner.address, ...bound })).rejects.toThrow("runs testnet");
  expect(actions.submit({ action, signature }, { expectedSigner: owner.address, allowDestination: allow })).rejects.toThrow("stored payout quote");
  // A correctly signed action for a different amount than the reviewed quote is refused (Codex: 250 vs 25).
  const bigger = actions.sendAsset({ ...transfer, amount: "10" }, 8453);
  const biggerSig = await sign(bigger.typedData);
  expect(actions.submit({ action: bigger.action, signature: biggerSig }, { expectedSigner: owner.address, ...bound })).rejects.toThrow("doesn't match the reviewed quote");
  expect(actions.submit({ action, signature }, { expectedSigner: owner.address, ...bound, deadline: new Date(Date.now() - 1000).toISOString() })).rejects.toThrow("deadline passed");

  const ok = await actions.submit({ action, signature }, { expectedSigner: owner.address, ...bound });
  expect(ok.signer).toBe(owner.address.toLowerCase());
  expect(calls).toHaveLength(1);
  expect((calls[0] as { signature: { v: number } }).signature.v).toBeOneOf([27, 28]);
});
