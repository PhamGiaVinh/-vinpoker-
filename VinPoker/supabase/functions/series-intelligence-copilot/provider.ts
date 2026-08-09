import type { SafeProviderReceiptV1, ServerCopilotContextV1, VResponseV1 } from "./contracts.ts";

export interface SeriesCopilotProviderRequestV1 {
  question: string;
  context: ServerCopilotContextV1;
  selectedOptionIds: readonly string[];
  signal?: AbortSignal;
}

export interface SeriesCopilotProviderResultV1 {
  response: VResponseV1;
  receipt: SafeProviderReceiptV1;
}

export interface SeriesCopilotProvider {
  ask(request: SeriesCopilotProviderRequestV1): Promise<SeriesCopilotProviderResultV1>;
}

export class SeriesCopilotProviderError extends Error {
  constructor(public readonly code: "PROVIDER_NOT_CONFIGURED" | "PROVIDER_TIMEOUT" | "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "PROVIDER_RESPONSE_REJECTED", message: string) {
    super(message);
    this.name = "SeriesCopilotProviderError";
  }
}
