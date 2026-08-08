import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

export type ChipOpsTournamentOption = {
  id: string;
  name: string;
  status: string;
  startTime: string | null;
};

export type IssuedChipDenomination = {
  denominationId: string;
  value: number;
  color: string | null;
  issuedCount: number;
};

export type IssuedChipInventory = {
  tournamentId: string;
  denominations: IssuedChipDenomination[];
  totalValue: number;
  reconciliationValue: number;
  reconciled: boolean;
};

type OpsClient = SupabaseClient<Database>;

export async function loadChipOpsTournamentOptions(
  client: OpsClient,
  clubId: string,
): Promise<ChipOpsTournamentOption[]> {
  const result = await client
    .from("tournaments")
    .select("id, name, status, start_time")
    .eq("club_id", clubId)
    .is("deleted_at", null)
    .order("start_time", { ascending: false })
    .limit(200);
  if (result.error) throw new Error("CHIP_OPS_TOURNAMENT_READ_FAILED");
  return (result.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    startTime: row.start_time,
  }));
}

export async function loadIssuedChipInventory(
  client: OpsClient,
  tournamentId: string,
): Promise<IssuedChipInventory> {
  const result = await client.rpc("get_issued_chip_inventory", {
    p_tournament_id: tournamentId,
  });
  if (result.error) throw new Error("CHIP_OPS_INVENTORY_READ_FAILED");
  return parseIssuedChipInventory(result.data, tournamentId);
}

export function parseIssuedChipInventory(value: Json, expectedTournamentId: string): IssuedChipInventory {
  if (!isRecord(value)) throw new Error("CHIP_OPS_INVENTORY_MALFORMED");
  if (typeof value.error === "string") throw new Error(safeServerCode(value.error));
  if (value.tournament_id !== expectedTournamentId) throw new Error("CHIP_OPS_INVENTORY_SCOPE_MISMATCH");
  if (!Array.isArray(value.denominations)) throw new Error("CHIP_OPS_INVENTORY_MALFORMED");
  if (!isSafeAmount(value.total_value) || !isSafeAmount(value.reconciliation_value)) {
    throw new Error("CHIP_OPS_INVENTORY_MALFORMED");
  }
  if (typeof value.reconciled !== "boolean") throw new Error("CHIP_OPS_INVENTORY_MALFORMED");

  const denominations = value.denominations.map((candidate) => {
    if (!isRecord(candidate)
      || typeof candidate.denomination_id !== "string"
      || !isSafeAmount(candidate.value)
      || !isSafeAmount(candidate.issued_count_total)
      || !(candidate.color === null || typeof candidate.color === "string")) {
      throw new Error("CHIP_OPS_INVENTORY_MALFORMED");
    }
    return {
      denominationId: candidate.denomination_id,
      value: candidate.value,
      color: candidate.color as string | null,
      issuedCount: candidate.issued_count_total,
    };
  });

  return {
    tournamentId: expectedTournamentId,
    denominations,
    totalValue: value.total_value,
    reconciliationValue: value.reconciliation_value,
    reconciled: value.reconciled,
  };
}

function isRecord(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeAmount(value: Json | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function safeServerCode(value: string): string {
  return /^[A-Z][A-Z0-9_]*$/u.test(value) ? `CHIP_OPS_${value}` : "CHIP_OPS_INVENTORY_READ_FAILED";
}
