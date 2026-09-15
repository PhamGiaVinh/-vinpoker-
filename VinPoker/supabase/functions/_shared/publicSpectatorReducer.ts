type PayoutItem = {
  fromPlace: number;
  toPlace: number;
  amountPerPlayer: number;
  playerName: string | null;
  avatarUrl: string | null;
  resultStatus: "official" | "open";
};

export function reducePublicSpectatorPayload(component: string, payload: unknown): unknown {
  if (component !== "payout" || !isRecord(payload) || !Array.isArray(payload.items)) return payload;
  const rows = payload.items.filter(isPayoutItem).sort((a, b) => a.fromPlace - b.fromPlace);
  const grouped: PayoutItem[] = [];
  for (const row of rows) {
    const previous = grouped.at(-1);
    if (previous && previous.resultStatus === "open" && row.resultStatus === "open" && previous.amountPerPlayer === row.amountPerPlayer && previous.toPlace + 1 === row.fromPlace) {
      previous.toPlace = row.toPlace;
    } else grouped.push({ ...row });
  }
  return { ...payload, items: grouped };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPayoutItem(value: unknown): value is PayoutItem {
  if (!isRecord(value)) return false;
  return Number.isInteger(value.fromPlace) && Number.isInteger(value.toPlace) && typeof value.amountPerPlayer === "number"
    && (value.resultStatus === "official" || value.resultStatus === "open");
}
