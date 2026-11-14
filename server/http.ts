export class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export async function providerJson(
  url: string | URL,
  init: RequestInit,
  provider: string,
  request = fetch,
): Promise<unknown> {
  try {
    const response = await request(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new RequestError(
        response.status === 429 ? 503 : 502,
        "provider_error",
        `${provider} returned HTTP ${response.status}`,
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(502, "provider_unavailable", `${provider} could not return a response`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDecimal(value: unknown): value is string {
  return typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value);
}

export function isUnits(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}
