export type BagRow = {
  playerId: string; seatNumber: number; trackedStack: number;
  bagCode: string | null; bagTotal: number | null; bagRevision: number;
  sealed: boolean; sealedVersion: number | null;
};
export type BagState = {
  status: "bagging" | "locked"; dayNumber: number; dayVersion: number;
  rosterHash: string; manager: boolean; rows: BagRow[];
};

export function parseMultiDayBaggingState(value: unknown): BagState {
  if (!value || typeof value !== "object") throw new Error("Bagging response is unavailable.");
  const item = value as Record<string, unknown>;
  if ((item.status !== "bagging" && item.status !== "locked")
    || !Number.isSafeInteger(item.dayNumber) || !Number.isSafeInteger(item.dayVersion)
    || typeof item.rosterHash !== "string" || typeof item.manager !== "boolean"
    || !Array.isArray(item.rows)) throw new Error("Bagging response is invalid.");
  const rows = item.rows.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("Bagging roster is invalid.");
    const row = entry as Record<string, unknown>;
    if (typeof row.playerId !== "string" || !Number.isSafeInteger(row.seatNumber)
      || !Number.isSafeInteger(row.trackedStack) || !Number.isSafeInteger(row.bagRevision)
      || !(row.bagCode === null || typeof row.bagCode === "string")
      || !(row.bagTotal === null || Number.isSafeInteger(row.bagTotal))
      || typeof row.sealed !== "boolean"
      || !(row.sealedVersion === null || Number.isSafeInteger(row.sealedVersion))) {
      throw new Error("Bagging roster is invalid.");
    }
    return row as BagRow;
  });
  return { status: item.status, dayNumber: item.dayNumber as number,
    dayVersion: item.dayVersion as number, rosterHash: item.rosterHash,
    manager: item.manager, rows };
}
