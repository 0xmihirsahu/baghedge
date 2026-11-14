import { fromUnits } from "../shared/amounts";
import { createIntents, BASE_USDC } from "../server/intents";

const intents = createIntents(process.env.INTENTS_BASE_URL, process.env.INTENTS_JWT);
const baseAddress = "0x1111111111111111111111111111111111111111";
const venueAddress = "0x2222222222222222222222222222222222222222";

for (const direction of ["fund", "withdraw"] as const) {
  const quote = await intents.quote({ direction, role: "hedge", baseAddress, venueAddress, amount: "25", dry: true, externalAsset: BASE_USDC.id });
  console.log(JSON.stringify({
    direction,
    dry: quote.dry,
    inputUsdc: fromUnits(BigInt(quote.amountIn), quote.originDecimals),
    quotedUsdc: fromUnits(BigInt(quote.amountOut), quote.destinationDecimals),
    minimumUsdc: fromUnits(BigInt(quote.minAmountOut), quote.destinationDecimals),
    transfer: quote.transfer,
  }));
}
