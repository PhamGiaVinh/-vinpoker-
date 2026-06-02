// ═══════════════════════════════════════════════════════════
// FILE: supabase/functions/process-swing/passes/pass2.5-initial-assign.ts
// Pass 2.5 — Assign initial dealers to tables that have an
// assignment without a dealer (dealer_id IS NULL).
//
// Why separate from fillEmptyTables:
//   fillEmptyTables handles tables with NO assignment at all.
//   Pass 2.5 handles tables that have an assignment but no
//   dealer_id — the attendance_id exists but the dealer link
//   was never set (e.g. pre-assign set attendance_id but the
//   subsequent swing that writes dealer_id failed).
// ═══════════════════════════════════════════════════════════

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickNextDealer } from "../../_shared/dealer-utils.ts";

interface Pass25Result {
  assigned_count: number;
  skipped_count: number;
  errors: Array<{ assignment_id: string; table_name: string; error: string }>;
}

export async function pass25InitialAssign(
  admin: SupabaseClient,
  clubId: string,
  cycleExcludedIds: Set<string>,
  requiredGameTypes?: string[],
): Promise<Pass25Result> {
  console.log("[Pass 2.5] 🔍 Checking for assignments without dealer_id...");

  const result: Pass25Result = {
    assigned_count: 0,
    skipped_count: 0,
    errors: [],
  };

  try {
    // ════════════════════════════════════════════════════════
    // STEP 1: Find assignments with dealer_id IS NULL
    // ════════════════════════════════════════════════════════

    const { data: emptyAssignments, error: queryErr } = await admin
      .from("dealer_assignments")
      .select(`
        id, table_id, attendance_id, version, overtime_started_at,
        game_tables!inner(id, table_name),
        dealer_attendance!attendance_id(
          id, dealer_id, current_state, worked_minutes_since_last_break, priority_break_flag
        )
      `)
      // Phase 1: scope to club via denormalized club_id (indexed, no join needed)
      .eq("club_id", clubId)
      .eq("status", "assigned")
      .is("dealer_id", null)
      .is("released_at", null)
      .is("swing_processed_at", null);

    if (queryErr) {
      console.error("[Pass 2.5] ❌ Query error:", queryErr.message);
      return result;
    }

    if (!emptyAssignments || emptyAssignments.length === 0) {
      console.log("[Pass 2.5] ✅ No assignments missing dealer_id");
      return result;
    }

    console.log(
      `[Pass 2.5] Found ${emptyAssignments.length} assignments without dealer_id`
    );

    // ════════════════════════════════════════════════════════
    // STEP 2: Fill dealer_id for each empty assignment
    // ════════════════════════════════════════════════════════

    for (const assignment of emptyAssignments) {
      try {
        const tableName = (assignment.game_tables as any)?.table_name ?? "??";
        const attendance = (assignment as any).dealer_attendance;
        const existingDealerId = attendance?.dealer_id ?? null;

        if (existingDealerId) {
          // ── Case A: attendance_id already points to a valid dealer ──
          // Just fill dealer_id via RPC (CAS on version)
          const { data: rpcResult, error: rpcErr } = await admin.rpc(
            "fill_dealer_id",
            {
              p_assignment_id: assignment.id,
              p_expected_version: assignment.version,
            },
          );

          if (rpcErr) {
            result.errors.push({
              assignment_id: assignment.id,
              table_name: tableName,
              error: rpcErr.message,
            });
            console.error(`[Pass 2.5] ❌ RPC error for ${tableName}:`, rpcErr.message);
            continue;
          }

          if ((rpcResult as any)?.ok === true) {
            result.assigned_count++;
            console.log(
              `[Pass 2.5] ✅ ${tableName}: dealer_id filled from existing attendance ` +
              `(${attendance.dealer_id})`
            );
          } else {
            result.skipped_count++;
            console.log(
              `[Pass 2.5] ⏭️ ${tableName}: ${(rpcResult as any)?.message ?? "RPC returned not ok"}`
            );
          }
        } else {
          // ── Case B: attendance has no valid dealer ──
          // Try pickNextDealer with progressive fallback (Level 1/2/3)
          const isOt = !!(assignment as any).overtime_started_at;

          let nextDealer = await pickNextDealer(admin, clubId, {
            currentTableId: assignment.table_id,
            excludeAttendanceIds: cycleExcludedIds,
            requiredGameTypes,
          });

          if (!nextDealer && isOt) {
            console.log(`[Pass 2.5] Level 2 fallback for OT table ${tableName}`);
            nextDealer = await pickNextDealer(admin, clubId, {
              currentTableId: assignment.table_id,
              excludeAttendanceIds: cycleExcludedIds,
              requiredGameTypes,
              skipPriorityBreakGuard: true,
            });
          }

          if (!nextDealer && isOt) {
            console.warn(`[Pass 2.5] Level 3 fallback for OT table ${tableName}`);
            nextDealer = await pickNextDealer(admin, clubId, {
              currentTableId: assignment.table_id,
              excludeAttendanceIds: cycleExcludedIds,
              requiredGameTypes,
              skipPriorityBreakGuard: true,
              skipFatigueHardCap: true,
            });
          }

          if (!nextDealer) {
            result.skipped_count++;
            console.log(`[Pass 2.5] ⏭️ ${tableName}: no dealer available`);
            continue;
          }

          // Assign via RPC with new attendance_id
          const { data: rpcResult, error: rpcErr } = await admin.rpc(
            "fill_dealer_id",
            {
              p_assignment_id: assignment.id,
              p_expected_version: assignment.version,
              p_new_attendance_id: nextDealer.id,
            },
          );

          if (rpcErr) {
            result.errors.push({
              assignment_id: assignment.id,
              table_name: tableName,
              error: rpcErr.message,
            });
            console.error(`[Pass 2.5] ❌ RPC error for ${tableName}:`, rpcErr.message);
            continue;
          }

          if ((rpcResult as any)?.ok === true) {
            cycleExcludedIds.add(nextDealer.id);
            result.assigned_count++;
            console.log(
              `[Pass 2.5] ✅ ${tableName}: assigned ${nextDealer.full_name} ` +
              `(${isOt ? "OT table" : "new table"})`
            );
          } else {
            result.skipped_count++;
            console.log(
              `[Pass 2.5] ⏭️ ${tableName}: ${(rpcResult as any)?.message ?? "RPC returned not ok"}`
            );
          }
        }
      } catch (error: any) {
        result.errors.push({
          assignment_id: assignment.id,
          table_name: (assignment as any).game_tables?.table_name ?? "??",
          error: error.message,
        });
        console.error(
          `[Pass 2.5] ❌ Error for assignment ${assignment.id}:`, error.message
        );
      }
    }

    // ════════════════════════════════════════════════════════
    // STEP 3: Summary
    // ════════════════════════════════════════════════════════

    console.log(
      `[Pass 2.5] ✅ Complete: ${result.assigned_count} assigned, ` +
      `${result.skipped_count} skipped, ${result.errors.length} errors`
    );

    return result;
  } catch (error: any) {
    console.error("[Pass 2.5] ❌ Fatal error:", error.message);
    return result;
  }
}
