import { Account, JsonRpcProvider, actions, getTransactionLastResult } from "near-api-js";

type Hex = `0x${string}`;
type Signature = { r: Hex; s: Hex; v: number };
type L1Action = Record<string, unknown>;
type Policy = { guardAgent: Hex; guardBuildHash: Hex; environment: "mainnet" | "testnet" };
type CancelRef = { intent: "entry" | "stop" | "resize" | "close" | "position_stop"; seq: number };
type GuardRequest = {
  operation: "sign_order";
  policy: Policy;
  ownerSig: Hex;
  chainId: number;
  action: L1Action;
  nonce: number;
  expiresAfter: number;
  entryUntilMs?: number;
  cancelRefs?: readonly CancelRef[];
};

export type OutLayerExecutor = {
  buildHash: Hex;
  agent: Hex;
  environment: Policy["environment"];
  run(request: GuardRequest): Promise<unknown>;
};

export class GuardRefused extends Error {
  constructor(reason: string) {
    super(`OutLayer guard refused the action: ${reason}`);
    this.name = "GuardRefused";
  }
}

export function createGuardSigner(context: {
  policy: Policy;
  ownerSig: Hex;
  chainId: number;
  entryUntilMs?: number;
  cancelRefs?: readonly CancelRef[];
}, executor: OutLayerExecutor) {
  const address = context.policy.guardAgent.toLowerCase() as Hex;
  if (!isHex(address, 20) || address !== executor.agent.toLowerCase() ||
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

export function createOutLayerExecutor(config: {
  caller: string;
  privateKey: `ed25519:${string}`;
  wasmUrl: string;
  buildHash: Hex;
  agent: Hex;
  environment: Policy["environment"];
  rpcUrl?: string;
}): OutLayerExecutor {
  const { caller, privateKey, wasmUrl, buildHash, agent, environment } = config;
  const wasm = new URL(wasmUrl);
  if (caller === "baghedge.near" || !isHex(buildHash, 32) || !isHex(agent, 20) ||
      wasm.protocol !== "https:" || wasm.port || wasm.username || wasm.password) {
    throw new Error("OutLayer requires a dedicated caller, a pinned HTTPS WASM and an attested agent");
  }
  const mainnet = environment === "mainnet";
  const rpc = new JsonRpcProvider({ url: config.rpcUrl ?? `https://rpc.${environment}.near.org` });
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

function isGuardRefusal(result: unknown): result is { ok: false; error: string } {
  return typeof result === "object" && result !== null &&
    "ok" in result && result.ok === false && "error" in result &&
    typeof result.error === "string" && result.error.length > 0 && !(
      "agent" in result || "r" in result || "s" in result || "v" in result || "connectionId" in result
    );
}

export function outLayerExecutorFromEnv(environment: Policy["environment"], env: NodeJS.ProcessEnv = process.env) {
  const caller = env.OUTLAYER_CALLER;
  const privateKey = env.OUTLAYER_NEAR_PRIVATE_KEY;
  const wasmUrl = env.OUTLAYER_WASM_URL;
  const buildHash = env.OUTLAYER_WASM_SHA256;
  const agent = env.OUTLAYER_AGENT_ADDRESS;
  if (!caller || !privateKey || !isEd25519Key(privateKey) || !wasmUrl ||
      !isHex(buildHash, 32) || !isHex(agent, 20)) {
    throw new Error("Incomplete OutLayer deployment configuration");
  }
  return createOutLayerExecutor({ caller, privateKey, wasmUrl, buildHash, agent, environment, rpcUrl: env.OUTLAYER_NEAR_RPC_URL });
}

export function buildOutLayerArgs(wasmUrl: string, buildHash: Hex, request: GuardRequest | { operation: "public_key" }) {
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

function isEd25519Key(value: string): value is `ed25519:${string}` {
  return /^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(value);
}
