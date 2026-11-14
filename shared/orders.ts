import { fromUnits } from "./amounts";
import type { HedgeAction, HedgeRule } from "./hedge";

type Market = { asset: number; sizeDecimals: number };
type ClientIds = { order: string; recovery?: string };

type Order = {
  a: number;
  b: boolean;
  p: string;
  s: string;
  r: boolean;
  c: string;
  t: { limit: { tif: "Ioc" } } | { trigger: { isMarket: false; triggerPx: string; tpsl: "sl" } };
};

export function buildHedgeOrder(
  market: Market,
  priceDecimals: number,
  rule: HedgeRule,
  action: HedgeAction,
  ids: ClientIds,
): { type: "order"; orders: Order[]; grouping: "na" | "normalTpsl" } {
  if (!Number.isSafeInteger(market.asset) || market.asset < 0 ||
    !Number.isInteger(market.sizeDecimals) || market.sizeDecimals < 0 || market.sizeDecimals > 6 ||
    !Number.isInteger(priceDecimals) || priceDecimals < 0 || priceDecimals > 6) throw new Error("Invalid market precision");
  if (!validId(ids.order) || action.lots <= 0n || action.lots > rule.maxLots) {
    throw new Error("Invalid hedge size or client order ID");
  }
  const entry = action.kind === "entry";
  if (action.reduceOnly === entry || action.limit !== (entry ? rule.entryFloor : rule.exitCeiling)) {
    throw new Error("Order does not match hedge policy");
  }
  const size = fromUnits(action.lots, market.sizeDecimals);
  const order: Order = {
    a: market.asset, b: !entry, p: wirePrice(action.limit, priceDecimals, market.sizeDecimals),
    s: size, r: !entry, t: { limit: { tif: "Ioc" } }, c: ids.order,
  };
  if (ids.recovery === undefined) return { type: "order", orders: [order], grouping: "na" };
  if (!entry || !validId(ids.recovery) || ids.order.toLowerCase() === ids.recovery.toLowerCase() ||
    rule.recoveryMark <= rule.entryMark || rule.exitCeiling < rule.recoveryMark) {
    throw new Error("Invalid attached recovery order");
  }
  const recovery: Order = {
    a: market.asset, b: true, p: wirePrice(rule.exitCeiling, priceDecimals, market.sizeDecimals),
    s: size, r: true,
    t: { trigger: {
      isMarket: false, tpsl: "sl", triggerPx: wirePrice(rule.recoveryMark, priceDecimals, market.sizeDecimals),
    } }, c: ids.recovery,
  };
  return { type: "order", orders: [order, recovery], grouping: "normalTpsl" };
}

function wirePrice(price: bigint, precision: number, sizeDecimals: number) {
  const value = fromUnits(price, precision);
  const fraction = value.split(".")[1];
  const digits = value.replace(".", "").replace(/^0+/, "");
  if (price <= 0n || (fraction && (fraction.length > 6 - sizeDecimals || digits.length > 5))) {
    throw new Error("Price does not fit the venue tick precision");
  }
  return value;
}

function validId(value: string) {
  return /^0x[0-9a-f]{32}$/i.test(value);
}
