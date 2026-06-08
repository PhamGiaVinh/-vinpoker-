// ═══════════════════════════════════════════════════════════
// FILE: supabase/functions/process-swing/passes/pass2-pre-assign.ts
// REWRITTEN — Previous version used non-existent columns
// (club_id, shift_id, status='active', ended_at) on dealer_assignments.
// Now uses correct schema: game_tables join, status='assigned',
// released_at, swing_processed_at, pickNextDealer + CAS RPC.
// ═══════════════════════════════════════════════════════════

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickNextDealer } from "../../_shared/dealer-utils.ts";

interface Pass2Result {
  pre_assigned_count: number;
  skipped_count: number;
  errors: Array<{ table_id: string; error: string }>;
}

interface PreAssignResult {
  outcome: "pre_assigned" | "race_lost" | "dealer_unavailable" | "error";
  dealer_id?: string;
  effective_swing_due_at?: string;
  original_swing_due_at?: string;
  rest_deficit_min?: number;
  current_rest_min?: number;
  detail?: string;
}

interface Pass2Options {
  clubZone: string | null;
  chatId: string | null;
  cycleExcludedIds: Set<string>;
  /** When set, overrides the window calculation.
   *  Default window: [now + (preAnnounceMinutes-2), now + (preAnnounceMinutes+2)]
   *  Manual window:  [now, now + manualWindowMinutes]
   *  Used by manual pre-assign trigger so cashier sees immediate results. */
  manualWindowMinutes?: number;
  /** Minimum inter-swing rest minutes for pickNextDealer cooldown. */
  minInterSwingRestMinutes?: number;
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

  const { clubZone, chatId, cycleExcludedIds, manualWindowMinutes } = options;

  // Emergency OT pre-announce window: 3 minutes instead of normal 6 min.
  // Tables in overtime get notified sooner so dealers can prepare.
  const EMERGENCY_OT_PRE_ANNOUNCE_MINUTES = 3;

  try {
    // ════════════════════════════════════════════════════════
    // STEP 1: Find assignments needing pre-assignment
    //
    // Normal tables: window [now + (preAnnounceMins - 2), now + (preAnnounceMins + 2)]
    //   e.g. preAnnounceMins=6 → window [T+4min, T+8min]
    //
    // OT emergency: window [now + (EMERGENCY_OT - 2), now + (EMERGENCY_OT + 2)]
    //   i.e. EMERGENCY_OT=3 → window [T+1min, T+5min]
    //
    // We query BOTH windows and merge (UNION behavior via OR).
    // Manual window:  [now, now + manualWindowMinutes]
    //   e.g. manualWindowMinutes=15 → window [T+0min, T+15min]
    // ════════════════════════════════════════════════════════

    const normalWindowStart = new Date(
      Date.now() + (manualWindowMinutes ? 0 : (preAnnounceMinutes - 2) * 60_000)
    ).toISOString();
    const normalWindowEnd = new Date(
      Date.now() + (manualWindowMinutes ?? (preAnnounceMinutes + 2)) * 60_000
    ).toISOString();

    // Emergency OT window: shorter notification window
    const otWindowStart = new Date(
      Date.now() + (EMERGENCY_OT_PRE_ANNOUNCE_MINUTES - 2) * 60_000
    ).toISOString();
    const otWindowEnd = new Date(
      Date.now() + (EMERGENCY_OT_PRE_ANNOUNCE_MINUTES + 2) * 60_000
    ).toISOString();

    // For manual trigger, use single wide window
    // For automatic: query normal window OR (OT window if overtime_started_at IS NOT NULL)
    const windowStart = manualWindowMinutes
      ? new Date(Date.now()).toISOString()
      : normalWindowStart;
    const windowEnd = manualWindowMinutes
      ? new Date(Date.now() + manualWindowMinutes * 60_000).toISOString()
      : normalWindowEnd;

    let upcomingAssignments: any[] = [];

    if (manualWindowMinutes) {
      // Manual trigger: single wide window
      const { data, error: queryErr } = await admin
        .from("dealer_assignments")
        .select(`
          id, table_id, attendance_id, swing_due_at, version, overtime_started_at,
          pre_assigned_attendance_id,
          game_tables!inner(id, table_name, table_type),
          dealer_attendance!attendance_id(
            dealers!inner(full_name, telegram_username, telegram_user_id)
          )
        `)
        .eq("club_id", clubId)
        .eq("status", "assigned")
        .is("released_at", null)
        .is("swing_processed_at", null)
        .is("pre_assigned_attendance_id", null)
        .gte("swing_due_at", windowStart)
        .lt("swing_due_at", windowEnd);

      if (queryErr) {
        console.error("[Pass 2] ❌ Query error:", queryErr.message);
        return result;
      }
      upcomingAssignments = data ?? [];
    } else {
      // Automatic: separate queries for normal and OT emergency windows
      // Normal tables: pre-announce at default window
      const { data: normalData, error: normalErr } = await admin
        .from("dealer_assignments")
        .select(`
          id, table_id, attendance_id, swing_due_at, version, overtime_started_at,
          pre_assigned_attendance_id,
          game_tables!inner(id, table_name, table_type),
          dealer_attendance!attendance_id(
            dealers!inner(full_name, telegram_username, telegram_user_id)
          )
        `)
        .eq("club_id", clubId)
        .eq("status", "assigned")
        .is("released_at", null)
        .is("swing_processed_at", null)
        .is("pre_assigned_attendance_id", null)
        .is("overtime_started_at", null)
        .gte("swing_due_at", normalWindowStart)
        .lt("swing_due_at", normalWindowEnd);

      if (normalErr) {
        console.error("[Pass 2] ❌ Normal window query error:", normalErr.message);
      }

      // OT emergency: shortened pre-announce window (3 min instead of 6)
      const { data: otData, error: otErr } = await admin
        .from("dealer_assignments")
        .select(`
          id, table_id, attendance_id, swing_due_at, version, overtime_started_at,
          pre_assigned_attendance_id,
          game_tables!inner(id, table_name, table_type),
          dealer_attendance!attendance_id(
            dealers!inner(full_name, telegram_username, telegram_user_id)
          )
        `)
        .eq("club_id", clubId)
        .eq("status", "assigned")
        .is("released_at", null)
        .is("swing_processed_at", null)
        .is("pre_assigned_attendance_id", null)
        .not("overtime_started_at", "is", null)
        .gte("swing_due_at", otWindowStart)
        .lt("swing_due_at", otWindowEnd);

      if (otErr) {
        console.error("[Pass 2] ❌ OT window query error:", otErr.message);
      }

      // Merge and deduplicate by assignment id
      const seen = new Set<string>();
      for (const row of [...(normalData ?? []), ...(otData ?? [])]) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          upcomingAssignments.push(row);
        }
      }
    }

    if (upcomingAssignments.length === 0) {
      console.log("[Pass 2] No tables needing pre-assignment in window");
      return result;
    }

    const otCount = upcomingAssignments.filter((a: any) => a.overtime_started_at).length;
    console.log(
      `[Pass 2] Found ${upcomingAssignments.length} tables needing pre-assignment ` +
      `(${otCount} OT emergency at ${EMERGENCY_OT_PRE_ANNOUNCE_MINUTES}min, ` +
      `${upcomingAssignments.length - otCount} normal at ${preAnnounceMinutes}min)`
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
          minInterSwingRestMinutes: options.minInterSwingRestMinutes ?? 10,
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

        const result_outcome = rpcResult as PreAssignResult | null;
        const outcome = result_outcome?.outcome;

        switch (outcome) {
          case "pre_assigned": {
            result.pre_assigned_count++;
            cycleExcludedIds.add(nextDealer.id);

            // NOTE: overtime_started_at is NOT cleared here. It was
            // previously cleared prematurely (before the RPC committed),
            // which broke the rollback path in execute_pre_assigned_swing
            // (step [8] would restore NULL instead of the original OT timestamp).
            // The RPC now handles OT clearing correctly in step [6] on success
            // and preserves the original value on rollback in step [8].

            // Bàn 10 fix: read effective_swing_due_at from RPC (may be delayed
            // by rest_deficit_min to enforce 10-min soft min rest). Fall back
            // to assignment.swing_due_at for backward compat if RPC didn't
            // return the field.
            const effectiveSwingAt = result_outcome?.effective_swing_due_at
              ?? assignment.swing_due_at;
            const restDeficit = result_outcome?.rest_deficit_min ?? 0;
            const currentRest = result_outcome?.current_rest_min ?? null;

            if (restDeficit > 0) {
              console.log(
                `[Pass 2] ⏸ ${tableName}: ${nextDealer.full_name} pre-assigned with ` +
                `rest deficit ${restDeficit}min (had ${currentRest}min rest, ` +
                `min 10min) — swing delayed from ${assignment.swing_due_at} ` +
                `to ${effectiveSwingAt}`,
              );
              // Diagnostic log only — no Telegram re-announce in v1.
              // BUG FIX 2026-06-06: diagnostic_logs schema is
              //   (id, timestamp, club_id, diagnostic_type, result, metadata, created_at).
              // Old code used non-existent columns (level, source, event, payload)
              // so the insert silently dropped fields. Use fire-and-forget to
              // avoid blocking the pre-assign loop.
              admin.from("diagnostic_logs").insert({
                club_id: clubId,
                diagnostic_type: "soft_min_rest_delay",
                result: {
                  table_id: assignment.table_id,
                  assignment_id: assignment.id,
                  dealer_id: result_outcome?.dealer_id ?? nextDealer.dealer_id ?? null,
                  dealer_name: nextDealer.full_name,
                  rest_deficit_min: restDeficit,
                  current_rest_min: currentRest,
                  original_due_at:
                    result_outcome?.original_swing_due_at ?? assignment.swing_due_at,
                  effective_due_at: effectiveSwingAt,
                },
                metadata: {
                  source: "pass2_pre_assign",
                },
              }).then(({ error }) => {
                if (error) {
                  console.warn("[Pass 2] diagnostic log insert failed:", error.message);
                }
              });
            }

            // Compute minutes until swing for the notification
            // Use effectiveSwingAt (post-delay) so notification matches
            // the actual swing time after server-side delay.
            const swingAt = new Date(effectiveSwingAt).getTime();
            const minutesLeft = Math.max(0, Math.floor((swingAt - Date.now()) / 60_000));

            console.log(
              `[Pass 2] ✅ ${tableName}: ${nextDealer.full_name} pre-assigned ` +
              `(swing in ~${minutesLeft} min)` +
              (restDeficit > 0 ? ` [delayed ${restDeficit}min for rest]` : ""),
            );

            // Telegram pre-announce notification
            // BUG #2 fix: insert into pre_announce_jobs DB queue instead of
            // an in-memory notifier queue. The DB queue survives EF restarts,
            // supports retry, and is idempotent via the partial unique index
            // uq_pre_announce_active (prevents duplicate Telegrams).
            // A separate cron EF (process-pre-announce-jobs) processes the queue.
            if (chatId) {
              const outgoing = (assignment as any).dealer_attendance?.dealers ?? {};
              const outgoingAtt = (assignment as any).dealer_attendance ?? {};
              const { error: jobErr } = await admin
                .from("pre_announce_jobs")
                .insert({
                  club_id: clubId,
                  table_id: assignment.table_id,
                  assignment_id: assignment.id,
                  attendance_id: nextDealer.id,
                  out_attendance_id: outgoingAtt.id ?? null,
                  table_name: tableName,
                  zone: clubZone,
                  in_dealer_name: nextDealer.full_name,
                  in_dealer_username: nextDealer.telegram_username ?? null,
                  out_dealer_name: outgoing.full_name ?? null,
                  out_dealer_username: outgoing.telegram_username ?? null,
                  swing_at: effectiveSwingAt,
                  minutes_left: minutesLeft,
                  rest_deficit_min: restDeficit,
                  chat_id: chatId,
                  status: "pending",
                  max_attempts: 3,
                })
                .select()
                .maybeSingle();

              if (jobErr) {
                // 23505 = unique_violation (duplicate active job) — safe to ignore
                if (jobErr.code === "23505") {
                  console.log(
                    `[Pass 2] ⏭️ ${tableName}: pre-announce job already exists ` +
                    `for ${nextDealer.full_name} (idempotent — no duplicate Telegram)`,
                  );
                } else {
                  console.warn(
                    `[Pass 2] ⚠️ ${tableName}: failed to enqueue pre-announce job:`,
                    jobErr.message,
                  );
                  // Do NOT fail the pre-assign — the dealer is still correctly assigned;
                  // only the Telegram notification was lost. A future cron run can
                  // backfill missed announcements (out of scope for PR #2).
                }
              } else {
                console.log(
                  `[Pass 2] 📬 ${tableName}: pre-announce job queued for ` +
                  `${nextDealer.full_name} (swing in ~${minutesLeft} min)`,
                );
              }
            } else {
              // No chatId — skip notification but still log so cashier can see
              console.log(
                `[Pass 2] ⏭️ ${tableName}: no Telegram chat configured, ` +
                `pre-assigned ${nextDealer.full_name} (swing in ~${minutesLeft} min)`,
              );
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
