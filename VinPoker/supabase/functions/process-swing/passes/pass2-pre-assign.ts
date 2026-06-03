// ═══════════════════════════════════════════════════════════
// FILE: supabase/functions/process-swing/passes/pass2-pre-assign.ts
// REWRITTEN — Previous version used non-existent columns
// (club_id, shift_id, status='active', ended_at) on dealer_assignments.
// Now uses correct schema: game_tables join, status='assigned',
// released_at, swing_processed_at, pickNextDealer + CAS RPC.
// ═══════════════════════════════════════════════════════════

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickNextDealer } from "../../_shared/dealer-utils.ts";
import { TelegramNotifier, type PreAssignEvent } from "../../_shared/telegramNotifier.ts";

interface Pass2Result {
  pre_assigned_count: number;
  skipped_count: number;
  errors: Array<{ table_id: string; error: string }>;
}

interface Pass2Options {
  clubZone: string | null;
  notifier: TelegramNotifier | null;
  cycleExcludedIds: Set<string>;
  botToken: string;
  /** When set, overrides the window calculation.
   *  Default window: [now + (preAnnounceMinutes-2), now + (preAnnounceMinutes+2)]
   *  Manual window:  [now, now + manualWindowMinutes]
   *  Used by manual pre-assign trigger so cashier sees immediate results. */
  manualWindowMinutes?: number;
}

export async function pass2PreAssignNext(
  admin: SupabaseClient,
  clubId: string,
  preAnnounceMinutes: number,
  options: Pass2Options,
): Promise<Pass2Result> {
  console.log("[Pass 2] 🔄 Pre-assigning next dealers...");

  const result: Pass2Result = {
    pre_assigned_count: 0,
    skipped_count: 0,
    errors: [],
  };

  const { clubZone, notifier, cycleExcludedIds, botToken, manualWindowMinutes } = options;

  try {
    // ════════════════════════════════════════════════════════
    // STEP 1: Find assignments needing pre-assignment
    // Default window: [now + (preAnnounceMins - 2), now + (preAnnounceMins + 2)]
    //   e.g. preAnnounceMins=6 → window [T+4min, T+8min]
    // Manual window:  [now, now + manualWindowMinutes]
    //   e.g. manualWindowMinutes=15 → window [T+0min, T+15min]
    // ════════════════════════════════════════════════════════

    const windowStart = new Date(
      Date.now() + (manualWindowMinutes ? 0 : (preAnnounceMinutes - 2) * 60_000)
    ).toISOString();
    const windowEnd = new Date(
      Date.now() + (manualWindowMinutes ?? (preAnnounceMinutes + 2)) * 60_000
    ).toISOString();

    const { data: upcomingAssignments, error: queryErr } = await admin
      .from("dealer_assignments")
      .select(`
        id, table_id, attendance_id, swing_due_at, version, overtime_started_at,
        pre_assigned_attendance_id,
        game_tables!inner(id, table_name, table_type),
        dealer_attendance!attendance_id(
          dealers!inner(full_name, telegram_username, telegram_user_id)
        )
      `)
      // Phase 1: scope to club via denormalized club_id (indexed, no join needed)
      .eq("club_id", clubId)
      // ✅ correct status value
      .eq("status", "assigned")
      // ✅ correct column name (was 'ended_at')
      .is("released_at", null)
      .is("swing_processed_at", null)
      // Skip tables that already have a pre-assigned dealer
      .is("pre_assigned_attendance_id", null)
      // Filter by swing due within pre-announce window
      .gte("swing_due_at", windowStart)
      .lt("swing_due_at", windowEnd);

    if (queryErr) {
      console.error("[Pass 2] ❌ Query error:", queryErr.message);
      // Don't throw — let other passes continue
      return result;
    }

    if (!upcomingAssignments || upcomingAssignments.length === 0) {
      console.log("[Pass 2] No tables needing pre-assignment in window");
      return result;
    }

    console.log(
      `[Pass 2] Found ${upcomingAssignments.length} tables needing pre-assignment ` +
      `(window ${preAnnounceMinutes - 2}–${preAnnounceMinutes + 2} min before swing)`
    );

    // ════════════════════════════════════════════════════════
    // STEP 2: Pre-assign one dealer per table
    // ════════════════════════════════════════════════════════

    for (const assignment of upcomingAssignments) {
      try {
        const tableName = (assignment.game_tables as any)?.table_name ?? "??";

        // Use pickNextDealer to find the best available dealer
        const nextDealer = await pickNextDealer(admin, clubId, {
          currentTableId: assignment.table_id,
          excludeAttendanceIds: cycleExcludedIds,
        });

        if (!nextDealer) {
          result.skipped_count++;
          console.log(`[Pass 2] ⏭️ ${tableName}: no available dealer`);
          continue;
        }

        // Call CAS-based RPC for atomic pre-assignment
        const { data: rpcResult, error: rpcErr } = await admin.rpc(
          "pre_assign_next_dealer_for_table",
          {
            p_assignment_id: assignment.id,
            p_club_id: clubId,
            p_next_attendance_id: nextDealer.id,
            p_version: assignment.version,
          },
        );

        if (rpcErr) {
          result.errors.push({ table_id: assignment.table_id, error: rpcErr.message });
          console.error(`[Pass 2] ❌ RPC error for ${tableName}:`, rpcErr.message);
          continue;
        }

        const outcome = (rpcResult as any)?.outcome;

        switch (outcome) {
          case "pre_assigned": {
            result.pre_assigned_count++;
            cycleExcludedIds.add(nextDealer.id);

            // BUG 2 FIX: Clear overtime_started_at since a replacement
            // is now on the way. The current dealer's OT is resolved.
            await admin
              .from("dealer_assignments")
              .update({ overtime_started_at: null })
              .eq("id", assignment.id)
              .not("overtime_started_at", "is", null);

            // Compute minutes until swing for the notification
            const swingAt = new Date(assignment.swing_due_at).getTime();
            const minutesLeft = Math.max(0, Math.floor((swingAt - Date.now()) / 60_000));

            console.log(
              `[Pass 2] ✅ ${tableName}: ${nextDealer.full_name} pre-assigned ` +
              `(swing in ~${minutesLeft} min)`
            );

            // Telegram pre-announce notification
            if (notifier) {
              const outgoing = (assignment as any).dealer_attendance?.dealers ?? {};
              notifier.enqueue({
                type: "pre_assign",
                tableName,
                zone: clubZone,
                outName: outgoing.full_name ?? "Unknown",
                outUsername: outgoing.telegram_username ?? null,
                inName: nextDealer.full_name,
                inUsername: nextDealer.telegram_username ?? null,
                swingAt: new Date(assignment.swing_due_at),
                minutesLeft,
              } satisfies PreAssignEvent);
            }
            break;
          }

          case "race_lost": {
            result.skipped_count++;
            console.log(`[Pass 2] ⏭️ ${tableName}: race_lost (concurrent swing)`);
            break;
          }

          case "dealer_unavailable": {
            result.skipped_count++;
            console.log(`[Pass 2] ⏭️ ${tableName}: dealer ${nextDealer.full_name} unavailable (taken by another tick)`);
            // Don't add to cycleExcludedIds — dealer wasn't actually assigned
            break;
          }

          default: {
            result.errors.push({
              table_id: assignment.table_id,
              error: `Unknown outcome: ${outcome}`,
            });
            console.error(`[Pass 2] ❌ ${tableName}: unknown outcome "${outcome}"`);
          }
        }
      } catch (error: any) {
        result.errors.push({
          table_id: assignment.table_id,
          error: error.message,
        });
        console.error(`[Pass 2] ❌ Error for table ${assignment.table_id}:`, error.message);
      }
    }

    // ════════════════════════════════════════════════════════
    // STEP 3: Summary
    // ════════════════════════════════════════════════════════

    console.log(
      `[Pass 2] ✅ Complete: ${result.pre_assigned_count} pre-assigned, ` +
      `${result.skipped_count} skipped, ${result.errors.length} errors`
    );

    return result;
  } catch (error: any) {
    console.error("[Pass 2] ❌ Fatal error:", error.message);
    return result;
  }
}
