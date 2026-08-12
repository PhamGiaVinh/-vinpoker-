export type HistoricalSettlementRequestMode = "preview" | "commit";

export type HistoricalSettlementDiagnostic = {
  code: string;
  httpStatus: number | null;
  responseParsed: boolean;
  mode: HistoricalSettlementRequestMode;
  handId: string;
};

type FunctionErrorLike = {
  context?: unknown;
  status?: unknown;
};

type ResponseLike = {
  status?: unknown;
  clone?: () => { json?: () => Promise<unknown> };
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function status(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

function publicCode(value: unknown): string | null {
  const code = record(value)?.code;
  return typeof code === "string" && /^[a-z0-9_]{1,120}$/.test(code) ? code : null;
}

function fallbackCode(mode: HistoricalSettlementRequestMode, httpStatus: number | null): string {
  const prefix = `historical_${mode}`;
  if (httpStatus === 401) return `${prefix}_unauthorized`;
  if (httpStatus === 403) return `${prefix}_forbidden`;
  if (httpStatus === 404) return `${prefix}_not_found`;
  if (httpStatus === 422) return `${prefix}_verification_blocked`;
  if (httpStatus !== null && httpStatus >= 500) return `${prefix}_server_failed`;
  return `${prefix}_transport_failed`;
}

/**
 * Returns only public Edge failure metadata. It deliberately excludes headers,
 * cookies, authorization credentials, and error stacks.
 */
export async function diagnoseHistoricalSettlementInvocation(input: {
  data: unknown;
  error: unknown;
  mode: HistoricalSettlementRequestMode;
  handId: string;
}): Promise<HistoricalSettlementDiagnostic> {
  const error = record(input.error) as FunctionErrorLike | null;
  const response = record(error?.context) as ResponseLike | null;
  const httpStatus = status(error?.status) ?? status(response?.status);

  let body = input.data;
  let responseParsed = record(body) !== null;
  if (!publicCode(body) && response?.clone) {
    try {
      const parsed = await response.clone().json?.();
      if (record(parsed)) {
        body = parsed;
        responseParsed = true;
      }
    } catch {
      // A malformed/non-JSON public response is still reported without details.
    }
  }

  return {
    code: publicCode(body) ?? fallbackCode(input.mode, httpStatus),
    httpStatus,
    responseParsed,
    mode: input.mode,
    handId: input.handId,
  };
}
