/**
 * _shared/fillEmptyTables.ts
 *
 * Auto-fill tables that have NO active dealer assignment.
 *
 * Process:
 *   1. Find all active tables for the club (optionally filtered by shift).
 *   2. Exclude tables that already have an active assignment.
 *   3. For each empty table, attempt up to 3 rounds to find a dealer via
 *      pickNextDealer, handling RPC conflicts on each attempt.
 *
 * This runs BEFORE pre-assign (Pass 2) so empty tables get priority
 * over upcoming swing windows.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickNextDealer, type DealerCandidate } from "./pickNextDealer.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FillResult {
  assignments: Array<{
    table_id: string;
    table_name: string;
    attendance_id: string;
    full_name: string;
    telegram_username?: string | null;
  }>;
  assignedAttendanceIds: Set<string>;
}

export type SupabaseAdmin = ReturnType<typeof createClient>;

// ─── fillEmptyTables ──────────────────────────────────────────────────────────

export async function fillEmptyTables(
  admin: SupabaseAdmin,
  clubId: string,
  shiftId: string | undefined,
  botToken: string,
  initialExclude?: Set<string>,
  swingDueAt?: string
): Promise<FillResult> {
  const result: FillResult = {
    assignments: [],
    assignedAttendanceIds: new Set(),
  };

  // Step 1: Fetch active tables for this club
  let tableQuery = admin
    .from("game_tables")
    .select("id, table_name, table_type, current_blind_level")
    .eq("club_id", clubId)
    .eq("status", "active");

  if (shiftId) tableQuery = tableQuery.eq("shift_id", shiftId);

  const { data: tables, error: tableErr } = await tableQuery;
  if (tableErr || !tables) return result;

  // Step 2: Find tables with existing active assignments
  const { data: activeAssignments } = await admin
    .from("dealer_assignments")
    .select("table_id")
    .in("status", ["assigned", "pre_assigned"])
    .in(
      "table_id",
      tables.map((t: { id: string }) => t.id)
    );

  const assignedTableIds = new Set(
    (activeAssignments ?? []).map((a: { table_id: string }) => a.table_id)
  );

  // Step 3: Pre-fetch tournament configs + table overrides (2 fixed queries, no N+1)
  const [tournamentsResult, tableOverridesResult] = await Promise.all([
    admin
      .from("tournaments")
      .select("id, swing_duration_minutes, tournament_tables!inner(table_id)")
      .eq("club_id", clubId)
      .eq("status", "active"),
    admin
      .from("swing_configs")
      .select("scope_id, swing_duration_minutes")
      .eq("club_id", clubId)
      .eq("scope_type", "table"),
  ]);

  const tournamentConfig = new Map<string, number>();
  for (const trn of tournamentsResult.data ?? []) {
    for (const tt of trn.tournament_tables) {
      tournamentConfig.set(tt.table_id, trn.swing_duration_minutes);
    }
  }

  const tableOverrideConfig = new Map<string, number>();
  for (const sc of tableOverridesResult.data ?? []) {
    tableOverrideConfig.set(sc.scope_id, sc.swing_duration_minutes);
  }

  // Step 4: Filter empty tables, sort by blind level descending (highest first)
  const emptyTables = tables
    .filter((t: { id: string }) => !assignedTableIds.has(t.id))
    .sort((a: { current_blind_level: number }, b: { current_blind_level: number }) =>
      (b.current_blind_level ?? 0) - (a.current_blind_level ?? 0)
    );

  const localExclude = new Set<string>(initialExclude ?? []);

  // Step 5: Assign dealers to each empty table with per-table swing_due_at
  // Priority: table override > tournament config > club default (swingDueAt param)
  const now = new Date();

  for (const [index, table] of emptyTables.entries()) {
    let assigned = false;

    const effectiveDuration = tableOverrideConfig.get(table.id)
      ?? tournamentConfig.get(table.id)
      ?? null;

    // Deterministic stagger: (index % 10) * 30s prevents synchronized OT entry.
    // Max 4.5min drift for any table regardless of club size.
    // Recycles cleanly for 20-30 table clubs.
    const stagger = (index % 10) * 30_000;

    const tableSwingDueAt = effectiveDuration != null
      ? new Date(now.getTime() + effectiveDuration * 60_000 + stagger).toISOString()
      : swingDueAt
        ? new Date(new Date(swingDueAt).getTime() + stagger).toISOString()
        : undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      // Build progressive exclusion: previously assigned + conflicted
      const excludeSet = new Set([
        ...localExclude,
        ...result.assignedAttendanceIds,
      ]);

      const dealer: DealerCandidate | null = await pickNextDealer(admin, clubId, {
        currentTableId: table.id,
        excludeAttendanceIds: excludeSet,
      });

      if (!dealer) break;

      const { data: rpcResult, error: rpcErr } = await admin.rpc(
        "assign_dealer_to_table",
        {
          p_table_id: table.id,
          p_attendance_id: dealer.id,
          p_swing_due_at: tableSwingDueAt,
        }
      );

      if (rpcErr) {
        console.warn(
          `[fillEmptyTables] assign conflict attempt ${attempt + 1} for table ${table.id}:`,
          rpcErr.message
        );
        // Add conflicted dealer to local exclude for next attempt
        localExclude.add(dealer.id);
        continue;
      }

      const outcome = typeof rpcResult === "string" ? rpcResult : rpcResult?.outcome;
      if (outcome === "ok") {
        localExclude.add(dealer.id);
        result.assignedAttendanceIds.add(dealer.id);
        result.assignments.push({
          table_id: table.id,
          table_name: table.table_name,
          attendance_id: dealer.id,
          full_name: dealer.full_name,
          telegram_username: dealer.telegram_username ?? null,
        });
        assigned = true;
        break;
      }

      if (outcome === "table_occupied") {
        console.warn(`[fillEmptyTables] Table ${table.table_name} (${table.id}) already occupied, skipping`);
        break;
      }

      if (outcome === "conflict") {
        localExclude.add(dealer.id);
        continue;
      }

      // Unknown result → treat as conflict
      console.warn(`[fillEmptyTables] Unknown RPC outcome '${outcome}' for table ${table.id}, dealer ${dealer.id}`);
      localExclude.add(dealer.id);
    }

    if (!assigned) {
      console.warn(
        `[fillEmptyTables] Could not assign dealer to table ${table.table_name} after 3 attempts`
      );
    }
  }

  return result;
}
