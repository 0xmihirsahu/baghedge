import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, baseEncode, getTransactionLastResult } from "near-api-js";
import { keccak256 } from "viem";

type Hex = `0x${string}`;
type Signature = { r: Hex; s: Hex; v: number };
type L1Action = Record<string, unknown>;
type Policy = { guardAgent: Hex; guardBuildHash: Hex; environment: "mainnet" | "testnet" };
type CancelRef = { intent: "entry" | "stop" | "resize" | "close" | "position_stop"; seq: number };
type OrderRef = { intent: Exclude<CancelRef["intent"], "stop">; seq: number };
type GuardContext = {
  policy: Policy;
  ownerSig: Hex;
  chainId: number;
  entryUntilMs?: number;
  orderRef?: OrderRef;
  cancelRefs?: readonly CancelRef[];
};
type GuardRequest = GuardContext & {
  operation: "sign_order";
  action: L1Action;
  nonce: number;
  expiresAfter: number;
};

type OwnerLookup = { operation: "public_key"; owner: Hex };
type TransportConfig = {
  caller: string;
  privateKey: `ed25519:${string}`;
  wasmUrl: string;
  buildHash: Hex;
  environment: Policy["environment"];
  rpcUrl?: string;
};

export type OutLayerExecutor = {
  buildHash: Hex;
  agent: Hex;
  environment: Policy["environment"];
  run(request: GuardRequest): Promise<unknown>;
};

export type MultiOwnerExecutor = Pick<OutLayerExecutor, "buildHash" | "environment" | "run"> & {
  discover(request: OwnerLookup): Promise<{ output: unknown; txHash: string }>;
};

export class GuardRefused extends Error {
  constructor(reason: string) {
    super(`OutLayer guard refused the action: ${reason}`);
    this.name = "GuardRefused";
  }
}

export function createGuardSigner(context: GuardContext, executor: OutLayerExecutor) {
  return scopedSigner(context, executor, executor.agent);
}

export function createGuardSignerFor(context: GuardContext & { policy: { hedgeAccount: Hex; tradeAccount: Hex } }, executor: MultiOwnerExecutor) {
  const hedge = walletAddress(context.policy.hedgeAccount);
  const trade = walletAddress(context.policy.tradeAccount);
  if (hedge === trade) throw new Error("Trade and Hedge must be separate accounts");
  // The WASM verifies the owner signature and re-derives this agent before signing.
  return scopedSigner(context, executor, walletAddress(context.policy.guardAgent));
}

export async function agentFor(executor: MultiOwnerExecutor, owner: Hex) {
  const requested = walletAddress(owner);
  const { output, txHash } = await executor.discover({ operation: "public_key", owner: requested });
  if (isGuardRefusal(output)) throw new GuardRefused(output.error);
  if (typeof output !== "object" || output === null || !("owner" in output) || output.owner !== requested ||
      !("address" in output) || !("publicKey" in output) || !isHex(output.publicKey, 64) ||
      !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(txHash)) {
    throw new Error("Invalid OutLayer owner agent response");
  }
  const address = walletAddress(output.address);
  if (`0x${keccak256(output.publicKey).slice(-40)}` !== address) {
    throw new Error("OutLayer agent address does not match its public key");
  }
  return { agentAddress: address, attestationTxHash: txHash };
}

function scopedSigner(context: GuardContext, executor: Pick<OutLayerExecutor, "buildHash" | "environment" | "run">, expectedAgent: Hex) {
  const address = context.policy.guardAgent.toLowerCase() as Hex;
  if (!isHex(address, 20) || address !== expectedAgent.toLowerCase() ||
      context.policy.guardBuildHash.toLowerCase() !== executor.buildHash.toLowerCase() ||
      context.policy.environment !== executor.environment) {
    throw new Error("Hedge policy does not match the configured OutLayer deployment");
  }
  return {
    address,
    kind: "guard" as const,
    async signL1(action: L1Action, nonce: number, expiresAfter?: number): Promise<Signature> {
      if (expiresAfter === undefined || !Number.isSafeInteger(expiresAfter) ||
          expiresAfter <= Date.now() || !Number.isSafeInteger(nonce) || nonce > expiresAfter) {
        throw new Error("OutLayer signing requires an unexpired venue action");
      }
      const result = await executor.run({ ...context, operation: "sign_order", action, nonce, expiresAfter });
      if (isGuardRefusal(result)) throw new GuardRefused(result.error);
      if (Date.now() >= expiresAfter) throw new Error("Venue action expired during OutLayer execution");
      if (typeof result !== "object" || result === null || !("ok" in result) || result.ok !== true) {
        throw new Error("Invalid OutLayer result; signing outcome is unknown");
      }
      if (!("agent" in result) || result.agent !== address || !("nonce" in result) || result.nonce !== nonce ||
          !("expiresAfter" in result) || result.expiresAfter !== expiresAfter ||
          !("r" in result) || !isHex(result.r, 32) || !("s" in result) || !isHex(result.s, 32) ||
          !("v" in result) || (result.v !== 27 && result.v !== 28)) {
        throw new Error("OutLayer result does not match the requested action");
      }
      // The exchange's verifiedSigner must still recover the signer from this exact L1 action.
      return { r: result.r, s: result.s, v: result.v };
    },
  };
}

export function createOutLayerExecutor(config: TransportConfig & { agent: Hex }): OutLayerExecutor {
  const { caller, privateKey, wasmUrl, buildHash, agent, environment } = config;
  const wasm = new URL(wasmUrl);
  if (caller === "baghedge.near" || !isHex(buildHash, 32) || !isHex(agent, 20) ||
      wasm.protocol !== "https:" || wasm.port || wasm.username || wasm.password) {
    throw new Error("OutLayer requires a dedicated caller, a pinned HTTPS WASM and an attested agent");
  }
  const mainnet = environment === "mainnet";
  const rpc = new JsonRpcProvider({ url: config.rpcUrl?.trim() || `https://rpc.${environment}.near.org` });
  const account = new Account(caller, rpc, privateKey);
  return {
    buildHash, agent, environment,
    async run(request) {
      const receiverId = mainnet ? "outlayer.near" : "outlayer.testnet";
      const args = buildOutLayerArgs(wasm.href, buildHash, request);
      const result = await account.signAndSendTransaction({
        receiverId,
        actions: [actions.functionCall("request_execution", args, 300_000_000_000_000n, 10n ** 23n)],
        waitUntil: "FINAL",
        retries: 0,
      });
      if (result.final_execution_status !== "FINAL") throw new Error("OutLayer execution did not reach finality");
      return getTransactionLastResult(result);
    },
  };
}

export function createMultiOwnerExecutor(config: TransportConfig): MultiOwnerExecutor {
  const { caller, privateKey, wasmUrl, buildHash, environment } = config;
  const wasm = new URL(wasmUrl);
  if (!caller || caller === "baghedge.near" || !isHex(buildHash, 32) ||
      wasm.protocol !== "https:" || wasm.port || wasm.username || wasm.password) {
    throw new Error("Multi-owner OutLayer requires its dedicated caller and a pinned HTTPS WASM");
  }
  const rpc = new JsonRpcProvider({ url: config.rpcUrl?.trim() || `https://rpc.${environment}.near.org` });
  const signer = new KeyPairSigner(KeyPair.fromString(privateKey));
  const account = new Account(caller, rpc, signer);
  const receiverId = environment === "mainnet" ? "outlayer.near" : "outlayer.testnet";
  let submission: Promise<unknown> = Promise.resolve();

  async function execute(request: GuardRequest | OwnerLookup) {
    // Share one NEAR access key: wait for inclusion before sending the next nonce, not for the full TEE run.
    const included = submission.then(async () => {
      if (request.operation === "sign_order" && Date.now() >= request.expiresAfter) {
        throw new Error("Venue action expired before OutLayer submission");
      }
      const args = buildOutLayerArgs(wasm.href, buildHash, request);
      const transaction = await account.createTransaction({
        receiverId,
        actions: [actions.functionCall("request_execution", args, 300_000_000_000_000n, 10n ** 23n)],
        publicKey: await signer.getPublicKey(),
      });
      const signed = await signer.signTransaction(transaction);
      if (request.operation === "sign_order" && Date.now() >= request.expiresAfter) {
        throw new Error("Venue action expired before OutLayer submission");
      }
      const result = await rpc.sendTransactionUntil(signed.signedTransaction, "INCLUDED");
      if (result.final_execution_status === "NONE") {
        throw new Error("OutLayer execution did not reach inclusion");
      }
      return baseEncode(signed.txHash);
    });
    submission = included.catch(() => undefined);
    const txHash = await included;
    const result = await rpc.viewTransactionStatus({ txHash, accountId: caller, waitUntil: "FINAL" });
    if (result.final_execution_status !== "FINAL" || result.transaction?.hash !== txHash ||
        result.transaction.signer_id !== caller || result.transaction.receiver_id !== receiverId) {
      throw new Error("OutLayer transaction does not match the finalized execution");
    }
    return { output: getTransactionLastResult(result), txHash };
  }

  return { buildHash, environment, discover: execute, run: async request => (await execute(request)).output };
}

function isGuardRefusal(result: unknown): result is { ok: false; error: string } {
  return typeof result === "object" && result !== null &&
    "ok" in result && result.ok === false && "error" in result &&
    typeof result.error === "string" && result.error.length > 0 && !(
      "agent" in result || "r" in result || "s" in result || "v" in result || "connectionId" in result
    );
}

export function outLayerExecutorFromEnv(environment: Policy["environment"], env: NodeJS.ProcessEnv = process.env) {
  const agent = env.OUTLAYER_AGENT_ADDRESS;
  if (!isHex(agent, 20)) throw new Error("Incomplete OutLayer deployment configuration");
  return createOutLayerExecutor({ ...transportConfig(environment, env), agent });
}

export function multiOwnerExecutorFromEnv(environment: Policy["environment"], env: NodeJS.ProcessEnv = process.env) {
  return createMultiOwnerExecutor(transportConfig(environment, env));
}

function transportConfig(environment: Policy["environment"], env: NodeJS.ProcessEnv): TransportConfig {
  const caller = env.OUTLAYER_CALLER;
  const privateKey = env.OUTLAYER_NEAR_PRIVATE_KEY;
  const wasmUrl = env.OUTLAYER_WASM_URL;
  const buildHash = env.OUTLAYER_WASM_SHA256;
  if (!caller || !privateKey || !isEd25519Key(privateKey) || !wasmUrl ||
      !isHex(buildHash, 32)) {
    throw new Error("Incomplete OutLayer deployment configuration");
  }
  return { caller, privateKey, wasmUrl, buildHash, environment, rpcUrl: env.OUTLAYER_NEAR_RPC_URL };
}

export function buildOutLayerArgs(wasmUrl: string, buildHash: Hex, request: GuardRequest | OwnerLookup | { operation: "public_key" }) {
  return {
    source: { WasmUrl: { url: wasmUrl, hash: buildHash.slice(2).toLowerCase(), build_target: "wasm32-wasip2" } },
    resource_limits: { max_instructions: 10_000_000_000, max_memory_mb: 128, max_execution_seconds: 60 },
    input_data: JSON.stringify(request),
    response_format: "Json",
  };
}

function isHex(value: unknown, bytes: number): value is Hex {
  return typeof value === "string" && value.length === 2 + 2 * bytes && /^0x[0-9a-fA-F]+$/.test(value);
}

function walletAddress(value: unknown): Hex {
  if (!isHex(value, 20) || /^0x0{40}$/.test(value)) throw new Error("Invalid OutLayer wallet address");
  return value.toLowerCase() as Hex;
}

function isEd25519Key(value: string): value is `ed25519:${string}` {
  return /^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(value);
}
