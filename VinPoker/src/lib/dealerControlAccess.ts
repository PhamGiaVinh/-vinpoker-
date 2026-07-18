export type DealerControlClub = {
  id: string;
  name: string;
};

type RpcClubRow = string | Record<string, unknown> | null | undefined;

/** Normalize PostgREST SETOF UUID payloads without letting malformed rows into .in(). */
export function normalizeClubIds(data: unknown, field: string): string[] {
  if (!Array.isArray(data)) return [];

  const ids = (data as RpcClubRow[]).map((row) => {
    if (typeof row === "string") return row;
    if (!row || typeof row !== "object") return null;
    const value = row[field];
    return typeof value === "string" ? value : null;
  });

  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/** Keep authorized IDs even when the display-name query returns fewer rows. */
export function mergeClubRows(
  ids: readonly string[],
  rows: unknown,
): DealerControlClub[] {
  const names = new Map<string, string>();

  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const id = (row as Record<string, unknown>).id;
      const name = (row as Record<string, unknown>).name;
      if (typeof id === "string" && typeof name === "string" && name.trim()) {
        names.set(id, name);
      }
    }
  }

  return ids.map((id) => ({
    id,
    name: names.get(id) ?? `CLB ${id.slice(0, 8)}`,
  }));
}
