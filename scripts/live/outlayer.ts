// OutLayer guard publishing and key lookup, signed by the executor account in .env.local.
//   bun scripts/live/outlayer.ts upload <path/to/<sha256>.wasm>   # FastFS publish (one tx, ≤1 MiB)
//   bun scripts/live/outlayer.ts public-key <wasmUrl> <sha256hex>   # request_execution {"operation":"public_key"}
// Never prints the private key. Prints only public data: tx hashes, URLs, the derived agent.
import { Account, JsonRpcProvider, actions, getTransactionLastResult } from "near-api-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { buildOutLayerArgs } from "../../server/guard";

const caller = process.env.OUTLAYER_CALLER;
const key = process.env.OUTLAYER_NEAR_PRIVATE_KEY;
if (!caller || !key?.startsWith("ed25519:")) throw new Error("Set OUTLAYER_CALLER and OUTLAYER_NEAR_PRIVATE_KEY in .env.local");
const rpc = new JsonRpcProvider({ url: process.env.OUTLAYER_NEAR_RPC_URL ?? "https://rpc.mainnet.fastnear.com" });
const account = new Account(caller, rpc, key as `ed25519:${string}`);

// Borsh for FastfsData::Simple { relativePath, content: Some({ mimeType, content }) } (fastnear/fastdata-drag-and-drop).
function encodeSimple(relativePath: string, mimeType: string, content: Uint8Array) {
  const str = (s: string) => { const b = Buffer.from(s, "utf8"); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
  const bytes = (b: Uint8Array) => { const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, Buffer.from(b)]); };
  return new Uint8Array(Buffer.concat([Buffer.from([0]), str(relativePath), Buffer.from([1]), str(mimeType), bytes(content)]));
}

const [cmd, a, b] = process.argv.slice(2);

if (cmd === "upload") {
  const file = new Uint8Array(readFileSync(a!));
  const sha = createHash("sha256").update(file).digest("hex");
  const name = basename(a!);
  if (name !== `${sha}.wasm`) throw new Error(`File name ${name} doesn't match its sha256 ${sha}`);
  if (file.length > 1 << 20) throw new Error("Over 1 MiB: needs partial FastFS upload");
  // FastFS reads the transaction arguments; the receipt itself is expected to fail on 1 gas.
  const result = await account.signAndSendTransaction({
    receiverId: "fastfs.near",
    actions: [actions.functionCall("__fastdata_fastfs", encodeSimple(name, "application/wasm", file), 1n, 0n)],
    throwOnFailure: false,
  } as never);
  const url = `https://main.fastfs.io/${caller}/fastfs.near/${name}`;
  console.log(JSON.stringify({ tx: (result as { transaction: { hash: string } }).transaction.hash, url, sha256: sha, bytes: file.length }));
}

if (cmd === "public-key") {
  const args = buildOutLayerArgs(a!, `0x${b}` as `0x${string}`, { operation: "public_key" });
  const result = await account.signAndSendTransaction({
    receiverId: "outlayer.near",
    actions: [actions.functionCall("request_execution", args, 300_000_000_000_000n, 10n ** 23n)],
  });
  console.log(JSON.stringify({ tx: result.transaction.hash, caller, output: getTransactionLastResult(result) }));
}
