import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  pickNextDealer,
  evaluateBreakNeed,
  computeSwingDuration,
  computeNextSwingAt,
  fillEmptyTables,
  getTableIdsForClub,
} from "../_shared/dealer-utils.ts";
import {
  sendTelegramNotification,
  getClubTelegramChatId,
  formatPreAnnounceMessage,
  notifyIncomingDealer,
  notifyFloorManagerDM,
} from "../_shared/telegram.ts";
import { TelegramNotifier } from "../_shared/telegramNotifier.ts";
import type {
  SwingInEvent,
  BreakStartEvent,
  PreAssignEvent,
} from "../_shared/telegramNotifier.ts";
import {
  calculateBatchSwingDuration,
  resolveSwingConfig,
  recomputeSwingDueAt,
  type PoolSnapshot,
  type SwingConfig,
} from "./calculateBatchSwingDuration.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STALE_PRE_ASSIGN_MINUTES = 20;
const DEFAULT_PRE_ANNOUNCE_MINUTES = 6;
const DEFAULT_PRE_ASSIGN_WINDOW_MINUTES = 4;
const DEFAULT_MAX_WORK_MINUTES = 120;
const DEFAULT_MIN_WORK_MINUTES = 60;
const DEFAULT_SWING_DURATION_MINUTES = 30;
const DEFAULT_BREAK_DURATION_MINUTES = 15;
const SWING_WINDOW_BUFFER_MINUTES = 2;
const MAX_SWING_RETRIES = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClubSwingConfig {
  swing_duration_minutes: number;
  break_duration_minutes: number;
  pre_announce_minutes: number;
  warn_at_minutes: number;
  crit_at_minutes: number;
  auto_adjust_duration: boolean;
  min_duration: number;
  auto_swing_enabled: boolean;
  base_duration_minutes: number;
  target_ratio: number;
  max_duration_minutes: number;
  sync_swings: boolean;
  sync_window_minutes: number;
}

// ─── Config fetching ──────────────────────────────────────────────────────────

async function fetchAllClubConfigs(
  admin: ReturnType<typeof createClient>
): Promise<Map<string, ClubSwingConfig>> {
  const configMap = new Map<string, ClubSwingConfig>();

  const { data: swingData, error } = await admin
    .from("swing_config")
    .select("*")
    .eq("table_type", "tournament");

  if (error) {
    console.error("[process-swing] fetchAllClubConfigs error:", error.message);
    return configMap;
  }

  const { data: settingsData } = await admin
    .from("club_settings")
    .select("club_id, auto_swing_enabled");

  const settingsMap = new Map<string, boolean>();
  for (const s of settingsData ?? []) {
    settingsMap.set(s.club_id, s.auto_swing_enabled ?? false);
  }

  for (const row of swingData ?? []) {
    configMap.set(row.club_id, {
      swing_duration_minutes: Math.max(30, row.swing_duration_minutes ?? DEFAULT_SWING_DURATION_MINUTES),
      break_duration_minutes: row.break_duration_minutes ?? DEFAULT_BREAK_DURATION_MINUTES,
      pre_announce_minutes: row.pre_announce_minutes ?? DEFAULT_PRE_ANNOUNCE_MINUTES,
      warn_at_minutes: row.warn_at_minutes ?? 5,
      crit_at_minutes: row.crit_at_minutes ?? 2,
      auto_adjust_duration: row.auto_adjust_duration ?? false,
      min_duration: Math.max(30, row.min_duration ?? 30),
      auto_swing_enabled: settingsMap.get(row.club_id) ?? true,
      base_duration_minutes: row.base_duration_minutes ?? row.swing_duration_minutes ?? 40,
      target_ratio: row.target_ratio ?? 1.43,
      max_duration_minutes: row.max_duration_minutes ?? 60,
      sync_swings: row.sync_swings ?? false,
      sync_window_minutes: row.sync_window_minutes ?? 5,
    });
  }
  return configMap;
}

function getClubConfig(
  configMap: Map<string, ClubSwingConfig>,
  clubId: string
): ClubSwingConfig {
  return (
    configMap.get(clubId) ?? {
      swing_duration_minutes: DEFAULT_SWING_DURATION_MINUTES,
      break_duration_minutes: DEFAULT_BREAK_DURATION_MINUTES,
      pre_announce_minutes: DEFAULT_PRE_ANNOUNCE_MINUTES,
      warn_at_minutes: 5,
      crit_at_minutes: 2,
      auto_adjust_duration: false,
      min_duration: 15,
      auto_swing_enabled: false,
      base_duration_minutes: DEFAULT_SWING_DURATION_MINUTES,
      target_ratio: 1.43,
      max_duration_minutes: 60,
      sync_swings: false,
      sync_window_minutes: 5,
    }
  );
}

async function getClubLocalDate(
  admin: ReturnType<typeof createClient>,
  clubId: string
): Promise<string> {
  const { data } = await admin.rpc("club_local_date", { p_club_id: clubId });
  return data ?? new Date().toISOString().split("T")[0];
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      console.error(
        "[process-swing] TELEGRAM_BOT_TOKEN is not set. " +
          "Swings will execute but Telegram notifications will be skipped. " +
          "Run: supabase secrets set TELEGRAM_BOT_TOKEN=<your_token>"
      );
    }

    const body = await req.json().catch(() => ({}));
    const {
      club_id: clubId,
      shift_id: shiftId,
      force_all: forceAll = false,
      dry_run: dryRun = false,
      manual_trigger: manualTrigger = false,
      required_game_types,
    } = body;

    const startTime = Date.now();
    const allClubConfigs = await fetchAllClubConfigs(admin);

    let clubIds: string[] = [];
    if (clubId) {
      clubIds = [clubId];
    } else {
      const { data: clubs } = await admin
        .from("clubs")
        .select("id")
        .in("status", ["approved"]);
      clubIds = (clubs ?? []).map((c: { id: string }) => c.id);
    }

    const metricsPerClub: Record<
      string,
      { total: number; success: number; failed: number; no_dealer: number; tg_failed: number; skipped: number }
    > = {};

    // ═══════════════════════════════════════════════════════════════════════════
    //  Process each club independently
    //  NOTE: Advisory lock removed. Per-row CAS (version column) protects
    //  against concurrent modifications. Race_lost handling in Pass 3
    //  deals with the rare CAS failure.
    // ═══════════════════════════════════════════════════════════════════════════
    for (const cid of clubIds) {
      try {
        if (!metricsPerClub[cid]) {
          metricsPerClub[cid] = { total: 0, success: 0, failed: 0, no_dealer: 0, tg_failed: 0, skipped: 0 };
        }
        const metrics = metricsPerClub[cid];
        const clubCfg = getClubConfig(allClubConfigs, cid);

        if (!manualTrigger && !clubCfg.auto_swing_enabled) {
          console.log(`[process-swing] Club ${cid} auto-swing disabled — skipping`);
          continue;
        }

        const cycleExcludedIds = new Set<string>();

        // ── TelegramNotifier for this club cycle ──────────────────────────
        let notifier: TelegramNotifier | null = null;
        let clubZone: string | null = null;
        if (botToken) {
          const [chatId, zoneData] = await Promise.all([
            getClubTelegramChatId(admin, cid),
            admin.from("swing_config").select("club_zone").eq("club_id", cid).maybeSingle(),
          ]);
          if (chatId) {
            notifier = new TelegramNotifier(botToken, chatId);
            clubZone = (zoneData as any)?.club_zone ?? null;
          }
        }

        // ── PASS 0 — Batch swing duration from pool snapshot ──────────────
        let batchDurationMinutes = clubCfg.swing_duration_minutes;
        let batchSwingDueAt: string | undefined;
        if (!dryRun) {
          try {
            const { data: snapshotData } = await admin.rpc("get_dealer_pool_snapshot", {
              p_club_id: cid,
            });
            if (snapshotData) {
              const snapshot = snapshotData as PoolSnapshot;
              const swingCfg: SwingConfig = resolveSwingConfig({
                swing_duration_minutes: clubCfg.swing_duration_minutes,
                auto_adjust_duration: clubCfg.auto_adjust_duration,
                base_duration_minutes: clubCfg.base_duration_minutes,
                target_ratio: clubCfg.target_ratio,
                min_duration_minutes: clubCfg.min_duration,
                max_duration_minutes: clubCfg.max_duration_minutes,
              });
              const batchResult = calculateBatchSwingDuration(swingCfg, snapshot);
              batchDurationMinutes = batchResult.durationMinutes;
              batchSwingDueAt = batchResult.swingDueAt;
              console.log(`[process-swing] Batch swing duration for club ${cid}: ${batchResult.rationale}`);
            }
          } catch (err) {
            console.warn(`[process-swing] Pool snapshot failed for club ${cid}, using config default:`, err);
          }
        }

        if (!dryRun && !batchSwingDueAt) {
          batchSwingDueAt = new Date(
            Date.now() + clubCfg.swing_duration_minutes * 60_000
          ).toISOString();
          console.log(`[process-swing] Fallback swingDueAt for club ${cid}: config default ${clubCfg.swing_duration_minutes}min`);
        }

        // ── PASS 0b — Query available dealer count for break deadlock guard ──
        let availableDealerCount: number | undefined;
        if (!dryRun) {
          const { count } = await admin
            .from("dealer_attendance")
            .select("id", { head: true, count: "exact" })
            .eq("current_state", "available")
            .eq("status", "checked_in");
          availableDealerCount = count ?? 0;
        }

        // ── PASS 1 — Auto-fill empty tables ───────────────────────────────
        // RUNS FIRST (before pre-assign) so tables with NO dealer get priority.
        // Pre-assign only targets tables that ALREADY have a dealer due to swing soon.
        let fillResult = { assignments: [] as Array<{table_id:string;table_name:string;attendance_id:string;full_name:string}>, assignedAttendanceIds: new Set<string>() };
        if (!dryRun) {
          fillResult = await fillEmptyTables(admin, cid, shiftId, botToken ?? "", cycleExcludedIds, batchSwingDueAt);
          for (const aid of fillResult.assignedAttendanceIds) cycleExcludedIds.add(aid);
          for (const a of fillResult.assignments) {
            notifier?.enqueue({
              type: "swing_in",
              tableName: a.table_name,
              zone: clubZone,
              dealerName: a.full_name,
              username: null,
            } satisfies SwingInEvent);
          }
        }

        // ── PASS 1b — Clean up stale pre_assign records ──────────────────
        const staleThreshold = new Date(
          Date.now() - STALE_PRE_ASSIGN_MINUTES * 60 * 1000
        ).toISOString();

        const { data: staleRows } = await admin
          .from("dealer_assignments")
          .select("id, pre_assigned_attendance_id")
          .eq("status", "assigned")
          .not("pre_assigned_attendance_id", "is", null)
          .lt("pre_assigned_at", staleThreshold)
          .lt("swing_due_at", new Date().toISOString())
          .in("table_id", await getTableIdsForClub(admin, cid));

        if (staleRows && staleRows.length > 0) {
          const staleAttendanceIds = staleRows
            .map((r: { pre_assigned_attendance_id: string }) => r.pre_assigned_attendance_id)
            .filter(Boolean);
          await admin
            .from("dealer_assignments")
            .update({ pre_assigned_attendance_id: null, pre_assigned_at: null })
            .in("id", staleRows.map((r: { id: string }) => r.id));
          if (staleAttendanceIds.length > 0) {
            await admin
              .from("dealer_attendance")
              .update({ current_state: "available" })
              .in("id", staleAttendanceIds);
          }
          console.log(`[process-swing] Pass 1b: cleaned ${staleRows.length} stale pre_assign records for club ${cid}`);
        }

        // ── PASS 2 — Pre-assign incoming dealer at T-N minutes ───────────
        // Runs AFTER fillEmptyTables so remaining dealers go to upcoming swings.
        // forceAll: skip pre-assign to preserve dealer pool for backlog processing.
        if (!forceAll) {
          const preAnnounceMins = clubCfg.pre_announce_minutes;
          const windowHalf = 2;
          const windowStart = new Date(Date.now() + Math.max(0, preAnnounceMins - windowHalf) * 60 * 1000).toISOString();
          const windowEnd = new Date(Date.now() + (preAnnounceMins + windowHalf) * 60 * 1000).toISOString();

          const { data: upcoming } = await admin
            .from("dealer_assignments")
            .select(
              `id, table_id, attendance_id, swing_due_at, version,
               game_tables(club_id, table_name, table_type),
               dealer_attendance!attendance_id(dealers(full_name))`
            )
            .eq("status", "assigned")
            .is("pre_assigned_attendance_id", null)
            .is("swing_processed_at", null)
            .gte("swing_due_at", windowStart)
            .lt("swing_due_at", windowEnd)
            .eq("game_tables.club_id", cid);

          for (const assignment of upcoming ?? []) {
            const excludeSet = new Set<string>([
              ...cycleExcludedIds,
              assignment.attendance_id,
            ]);

            const nextDealer = await pickNextDealer(admin, cid, {
              currentTableId: assignment.table_id,
              excludeAttendanceIds: excludeSet,
              requiredGameTypes: required_game_types,
            });

            if (!nextDealer) {
              if (botToken) {
                const chatId = await getClubTelegramChatId(admin, cid);
                if (chatId) {
                  const minsLeft = Math.round(
                    (new Date(assignment.swing_due_at).getTime() - Date.now()) / 60000
                  );
                  const outgoingDealer = assignment.dealer_attendance?.dealers ?? { full_name: "Unknown" };
                  await sendTelegramNotification(
                    botToken, chatId,
                    formatPreAnnounceMessage({
                      tableName: assignment.game_tables?.table_name ?? assignment.table_id,
                      outgoingDealer,
                      minutesLeft: minsLeft,
                    }),
                    {}
                  );
                }
              }
              continue;
            }

            // CAS update: only succeed if version matches and not already pre-assigned
            const { data: locked, error: lockErr } = await admin
              .from("dealer_assignments")
              .update({
                pre_assigned_attendance_id: nextDealer.id,
                pre_assigned_at: new Date().toISOString(),
                version: assignment.version + 1,
              })
              .eq("id", assignment.id)
              .eq("version", assignment.version)
              .is("pre_assigned_attendance_id", null)
              .select("id")
              .single();

            if (lockErr || !locked) {
              console.warn(`[process-swing] Pass 2: CAS failed for assignment ${assignment.id}, skipping`);
              continue;
            }

            cycleExcludedIds.add(nextDealer.id);
            await admin.from("dealer_attendance").update({ current_state: "pre_assigned" }).eq("id", nextDealer.id);

            const minsLeft = Math.round(
              (new Date(assignment.swing_due_at).getTime() - Date.now()) / 60000
            );
            const outgoingName = assignment.dealer_attendance?.dealers?.full_name ?? "";
            const incomingName = nextDealer.full_name ?? nextDealer.id;
            const incomingUsername = nextDealer.telegram_username ?? null;
            const tableName = assignment.game_tables?.table_name ?? assignment.table_id;
            const outUsername = (assignment.dealer_attendance?.dealers as any)?.telegram_username ?? null;

            notifier?.enqueue({
              type: "pre_assign",
              tableName,
              zone: clubZone,
              outName: outgoingName,
              outUsername,
              inName: incomingName,
              inUsername: incomingUsername,
              swingAt: new Date(assignment.swing_due_at),
              minutesLeft: minsLeft,
            } satisfies PreAssignEvent);

            if (nextDealer.telegram_user_id) {
              await notifyIncomingDealer(botToken, {
                ...nextDealer,
                telegram_user_id: Number(nextDealer.telegram_user_id),
              } as any, tableName, minsLeft).catch(() => {});
            }
          }
        } // end if (!forceAll)

        // ── Dynamic swing duration ────────────────────────────────────────
        const swingDurResult = await computeSwingDuration(admin, cid, {
          swing_duration_minutes: clubCfg.swing_duration_minutes,
          auto_adjust_duration: clubCfg.auto_adjust_duration,
          min_duration: clubCfg.min_duration,
          max_duration: clubCfg.max_duration_minutes,
          sync_swings: clubCfg.sync_swings,
          sync_window_minutes: clubCfg.sync_window_minutes,
        });
        console.log(`[process-swing] Club ${cid} swing duration:`, swingDurResult.durationRationale);

        // ── PASS 3 — Execute swings at T-0 ────────────────────────────────
        const nowPlusBuf = new Date(Date.now() + SWING_WINDOW_BUFFER_MINUTES * 60 * 1000).toISOString();
        const now = new Date().toISOString();

        const query = admin
          .from("dealer_assignments")
          .select(
            `id, table_id, attendance_id, swing_due_at, version,
             pre_assigned_attendance_id, overtime_started_at,
             last_ot_alert_at,
             game_tables(club_id, table_name, table_type),
             dealer_attendance!attendance_id(dealers(full_name, telegram_username, telegram_user_id))`
          )
          .eq("status", "assigned")
          .is("swing_processed_at", null)
          .eq("game_tables.club_id", cid);

        if (!forceAll) {
          query.lte("swing_due_at", nowPlusBuf);
        } else {
          query.lte("swing_due_at", now);
        }

        // LIMIT 8: Each perform_swing ~200-500ms, cron budget ~50s.
        // 8 × 500ms = 4s for swings, leaving headroom for Pass 1/2 queries.
        // Remaining OT tables caught on next tick (55s swing_due_at ensures re-entry).
        query.limit(8);

        const { data: rawDueAssignments, error: dueErr } = await query;
        if (dueErr) {
          console.error(`[process-swing] Pass 3 query error for club ${cid}:`, dueErr.message);
          continue;
        }

        // ═══ CRITICAL: Sort due assignments by swing_due_at ASC ═════════════
        // Oldest-due (furthest past due) first. This ensures fairness:
        // dealers who've been waiting longest get relief first.
        const dueAssignments = (rawDueAssignments ?? []).sort(
          (a: any, b: any) => new Date(a.swing_due_at).getTime() - new Date(b.swing_due_at).getTime()
        );

        // Pre-compute consistent swing_due_at for all Pass 3 swings
        const pass3SwingDueAt = dryRun ? undefined : computeNextSwingAt(
          swingDurResult.durationMinutes,
          clubCfg.sync_swings ? { sync_swings: true, sync_window_minutes: clubCfg.sync_window_minutes } : undefined
        );

        // ── DRY RUN ───────────────────────────────────────────────────────
        if (dryRun && dueAssignments.length > 0) {
          console.log(`[process-swing] DRY RUN — club ${cid} would swing ${dueAssignments.length} assignments, skipping Pass 3 execution`);
          for (const da of dueAssignments) {
            metrics.total++;
            metrics.success++;
          }
          continue;
        }

        for (const assignment of dueAssignments) {
          metrics.total++;
          const tableName = assignment.game_tables?.table_name ?? assignment.table_id;
          const outgoingDealer = assignment.dealer_attendance?.dealers ?? { full_name: "Unknown" };
          const minsLeft = Math.round(
            (new Date(assignment.swing_due_at).getTime() - Date.now()) / 60000
          );

          if (assignment.pre_assigned_attendance_id) {
            // ── Pre-assigned swing path ───────────────────────────────────
            const breakDecision = await evaluateBreakNeed(admin, assignment.attendance_id, {
              maxWorkMinutes: Math.max(DEFAULT_MAX_WORK_MINUTES, swingDurResult.durationMinutes * 3),
              minWorkMinutes: Math.max(DEFAULT_MIN_WORK_MINUTES, swingDurResult.durationMinutes * 2),
              clubId: cid,
              availableDealerCount,
            });

            const { data: rpcResult, error: rpcErr } = await admin.rpc(
              "execute_pre_assigned_swing",
              {
                p_old_assignment_id:  assignment.id,
                p_next_attendance_id: assignment.pre_assigned_attendance_id,
                p_swing_due_at:       pass3SwingDueAt,
                p_duration_minutes:   swingDurResult.durationMinutes,
                p_send_to_break:      breakDecision.shouldBreak,
              }
            );

            if (rpcErr) {
              console.error("[process-swing] execute_pre_assigned_swing RPC error:", rpcErr.message);
              metrics.failed++;
              continue;
            }

            switch (rpcResult?.status) {
              case "success":
                metrics.success++;
                cycleExcludedIds.add(assignment.pre_assigned_attendance_id);
                notifier?.enqueue({
                  type: "swing_in",
                  tableName,
                  zone: clubZone,
                  dealerName: rpcResult.incoming_name ?? "Unknown",
                  username: null,
                } satisfies SwingInEvent);
                if (breakDecision.shouldBreak) {
                  const outgoingUsername = (outgoingDealer as any)?.telegram_username ?? null;
                  notifier?.enqueue({
                    type: "break_start",
                    dealerName: outgoingDealer.full_name,
                    username: outgoingUsername,
                    durationMin: clubCfg.break_duration_minutes,
                  } satisfies BreakStartEvent);
                }
                break;

              case "race_lost": {
                cycleExcludedIds.add(assignment.pre_assigned_attendance_id);
                console.warn(`[process-swing] Pre-assign race_lost for ${tableName}, fallback...`);

                const { data: freshRow } = await admin
                  .from("dealer_assignments")
                  .select("id, version, overtime_started_at, status, swing_processed_at")
                  .eq("id", assignment.id)
                  .single();

                if (!freshRow) {
                  console.warn(`[process-swing] Assignment ${assignment.id} not found after race_lost`);
                  break;
                }

                if (freshRow.status === "completed" || freshRow.swing_processed_at !== null) {
                  console.log(`[process-swing] Assignment ${assignment.id} already completed`);
                  metrics.success++;
                  break;
                }

                const isOtFallback = !!(freshRow as any).overtime_started_at;
                const fbBreakDecision = isOtFallback
                  ? { shouldBreak: true, reason: "mandatory" as const, workedMinutes: 999 }
                  : await evaluateBreakNeed(admin, assignment.attendance_id, {
                      maxWorkMinutes: Math.max(DEFAULT_MAX_WORK_MINUTES, swingDurResult.durationMinutes * 3),
                      minWorkMinutes: Math.max(DEFAULT_MIN_WORK_MINUTES, swingDurResult.durationMinutes * 2),
                      clubId: cid,
                      availableDealerCount,
                    });

                const fbDealer = await pickNextDealer(admin, cid, {
                  currentTableId: assignment.table_id,
                  excludeAttendanceIds: cycleExcludedIds,
                  requiredGameTypes: required_game_types,
                });

                if (fbDealer) {
                  const { data: fbResult } = await admin.rpc("perform_swing", {
                    p_assignment_id: assignment.id,
                    p_version: freshRow.version,
                    p_next_attendance_id: fbDealer.id,
                    p_send_to_break: fbBreakDecision.shouldBreak,
                    p_break_duration_minutes: clubCfg.break_duration_minutes,
                    p_swing_duration_minutes: swingDurResult.durationMinutes,
                  });

                  if (fbResult?.outcome === "swung") {
                    metrics.success++;
                    cycleExcludedIds.add(fbDealer.id);
                    notifier?.enqueue({
                      type: "swing_in",
                      tableName,
                      zone: clubZone,
                      dealerName: fbDealer.full_name,
                      username: fbDealer.telegram_username ?? null,
                    } satisfies SwingInEvent);
                  } else if (fbResult?.outcome === "no_dealer") {
                    metrics.no_dealer++;
                    if (fbResult.is_new_overtime) {
                      const chatId = await getClubTelegramChatId(admin, cid);
                      if (botToken && chatId) {
                        await sendTelegramNotification(botToken, chatId,
                          `⏱ *Bàn ${tableName}* — Dealer đang OT (fallback sau race_lost).`, {});
                      }
                    }
                  } else {
                    metrics.failed++;
                    console.warn(`[process-swing] Fallback perform_swing outcome: ${fbResult?.outcome}`);
                  }
                } else {
                  // No fallback → OT path
                  const { data: otResult } = await admin.rpc("perform_swing", {
                    p_assignment_id: assignment.id,
                    p_version: freshRow.version,
                    p_next_attendance_id: null,
                    p_send_to_break: false,
                    p_break_duration_minutes: clubCfg.break_duration_minutes,
                    p_swing_duration_minutes: swingDurResult.durationMinutes,
                  });
                  metrics.no_dealer++;
                  if (otResult?.outcome === "no_dealer" && otResult?.is_new_overtime) {
                    const chatId = await getClubTelegramChatId(admin, cid);
                    if (botToken && chatId) {
                      await sendTelegramNotification(botToken, chatId,
                        `⏱ *Bàn ${tableName}* — Dealer OT (không người thay sau race_lost).`, {});
                    }
                  }
                }
                break;
              }

              default:
                console.error("[process-swing] execute_pre_assigned_swing failed:", rpcResult);
                metrics.failed++;
                break;
            }
          } else {
            // ── Non-pre-assigned path ─────────────────────────────────────
            const isOtDealer = !!(assignment as any).overtime_started_at;

            const breakDecision = isOtDealer
              ? { shouldBreak: true, reason: "mandatory" as const, workedMinutes: 999 }
              : await evaluateBreakNeed(admin, assignment.attendance_id, {
                  maxWorkMinutes: swingDurResult.durationMinutes * 3,
                  minWorkMinutes: swingDurResult.durationMinutes * 2,
                  clubId: cid,
                  availableDealerCount,
                });

            const nextExcludes = new Set([...cycleExcludedIds, assignment.attendance_id]);
            const nextDealer = await pickNextDealer(admin, cid, {
              currentTableId: assignment.table_id,
              excludeAttendanceIds: nextExcludes,
              requiredGameTypes: required_game_types,
            });

            // SAFEGUARD: verify dealer belongs to this club before assigning
            if (nextDealer?.id) {
              const { data: dealerClub } = await admin
                .from("dealers")
                .select("club_id")
                .eq("id", nextDealer.dealer_id)
                .single()
                .catch(() => ({ data: null }));
              if (!dealerClub || dealerClub.club_id !== cid) {
                console.warn(`[process-swing] SAFEGUARD: dealer ${nextDealer.full_name} club ${dealerClub?.club_id} != table club ${cid}, skipping`);
                await admin.from("dealer_attendance").update({ current_state: "available" }).eq("id", nextDealer.id);
                continue;
              }
            }

            const { data: swingResult } = await admin.rpc("perform_swing", {
              p_assignment_id: assignment.id,
              p_version: assignment.version,
              p_next_attendance_id: nextDealer?.id ?? null,
              p_send_to_break: breakDecision.shouldBreak,
              p_break_duration_minutes: clubCfg.break_duration_minutes,
              p_swing_duration_minutes: swingDurResult.durationMinutes,
              p_swing_due_at: pass3SwingDueAt,
            });

            const outcome = swingResult?.outcome ?? "failed";

            if (outcome === "swung") {
              metrics.success++;
              if (nextDealer?.id) cycleExcludedIds.add(nextDealer.id);
              if (nextDealer) {
                notifier?.enqueue({
                  type: "swing_in",
                  tableName,
                  zone: clubZone,
                  dealerName: nextDealer.full_name,
                  username: nextDealer.telegram_username ?? null,
                } satisfies SwingInEvent);
              }
              if (breakDecision.shouldBreak) {
                const outgoingUsername = (outgoingDealer as any)?.telegram_username ?? null;
                notifier?.enqueue({
                  type: "break_start",
                  dealerName: outgoingDealer.full_name,
                  username: outgoingUsername,
                  durationMin: clubCfg.break_duration_minutes,
                } satisfies BreakStartEvent);
              }
            } else if (outcome === "no_dealer") {
              metrics.no_dealer++;
              if (swingResult?.is_new_overtime === true) {
                const chatId = await getClubTelegramChatId(admin, cid);
                if (botToken && chatId) {
                  await sendTelegramNotification(
                    botToken, chatId,
                    `⏱ *Bàn ${tableName}* — ${outgoingDealer.full_name} đang làm thêm giờ (không có dealer thay).\nSẽ xoay vòng khi có dealer mới hoặc bàn đóng.`,
                    {}
                  );
                }
              } else if ((assignment as any).overtime_started_at) {
                const lastAlertAt = (assignment as any).last_ot_alert_at;
                const minutesSinceLastAlert = lastAlertAt
                  ? Math.floor((Date.now() - new Date(lastAlertAt).getTime()) / 60_000)
                  : 999;

                if (minutesSinceLastAlert >= 5) {
                  const otMs = Date.now() - new Date((assignment as any).overtime_started_at).getTime();
                  const otMinutes = Math.floor(otMs / 60_000);
                  const chatId = await getClubTelegramChatId(admin, cid);
                  if (botToken && chatId) {
                    await sendTelegramNotification(
                      botToken, chatId,
                      `⏱ *OT ${otMinutes}ph* — ${outgoingDealer.full_name} @ ${tableName} — vẫn chưa có người thay. Cần can thiệp!`,
                      {}
                    );
                  }

                  admin
                    .from("dealer_assignments")
                    .update({ last_ot_alert_at: new Date().toISOString() })
                    .eq("id", assignment.id)
                    .then(() => {})
                    .catch((e: Deno.errors.Error) =>
                      console.error("[process-swing] last_ot_alert_at update failed:", e.message)
                    );
                }
              }
            } else if (outcome === "swing_skipped") {
              metrics.skipped++;
              const chatId = await getClubTelegramChatId(admin, cid);
              if (botToken && chatId) {
                await sendTelegramNotification(botToken, chatId,
                  formatSwingSkippedAlert(tableName, swingResult.retry_count), {});
                await notifyFloorManagerDM(botToken, admin, cid,
                  formatSwingSkippedAlert(tableName, swingResult.retry_count));
              }
            } else {
              metrics.failed++;
            }
          }
        }

        // ── PASS 4 — End expired breaks ──────────────────────────────────
        if (!dryRun) {
          const { data: endedBreaks } = await admin.rpc("end_expired_breaks", {
            p_club_id: cid,
          });
          if (endedBreaks && endedBreaks.length > 0) {
            console.log(`[process-swing] Pass 4: ended ${endedBreaks.length} expired breaks for club ${cid}`,
              endedBreaks.map((b: any) => b.dealer_name).join(", "));
          }
        }

        // ── All-tables-OT alert ────────────────────────────────────────────
        // Query total active assignments for this club (not just Pass 3 window).
        // If NO active assignment is free of OT, the entire pool is stuck.
        const clubTableIds = await getTableIdsForClub(admin, cid);
        const { count: totalActiveCount } = await admin
          .from("dealer_assignments")
          .select("id", { count: "exact", head: true })
          .eq("status", "assigned")
          .in("table_id", clubTableIds);

        const { count: nonOtInClub } = await admin
          .from("dealer_assignments")
          .select("id", { count: "exact", head: true })
          .is("overtime_started_at", null)
          .eq("status", "assigned")
          .in("table_id", clubTableIds);

        if ((totalActiveCount ?? 0) > 0 && (nonOtInClub ?? 0) === 0) {
          const chatId = await getClubTelegramChatId(admin, cid);
          if (botToken && chatId) {
            await sendTelegramNotification(
              botToken, chatId,
              `🚨 *TOÀN BỘ ${totalActiveCount} BÀN ĐANG OT* — Pool dealer rỗng hoàn toàn.\nCần check-in thêm dealer hoặc đóng bớt bàn ngay!`,
              {}
            );
          }
        }

        // Flush TelegramNotifier
        notifier?.flush().catch((err) =>
          console.warn("[process-swing] notifier flush error:", err.message)
        );

        // ── Write metrics ─────────────────────────────────────────────────
        const localDate = await getClubLocalDate(admin, cid);
        if (metrics.total > 0 || metrics.skipped > 0) {
          await admin.from("swing_metrics").upsert(
            {
              club_id: cid,
              date: localDate,
              total_swings: metrics.total,
              successful_swings: metrics.success,
              failed_swings: metrics.failed,
              no_dealer_swings: metrics.no_dealer,
              skipped_swings: metrics.skipped,
              telegram_failures: metrics.tg_failed,
            },
            { onConflict: "club_id,date", ignoreDuplicates: false }
          );
        }
      } finally {
        // No advisory lock to release — we use per-row CAS.
        // Race_lost handling in Pass 3 deals with concurrent modifications.
      }
    }

    const processingMs = Date.now() - startTime;
    return new Response(
      JSON.stringify({
        ok: true,
        processing_ms: processingMs,
        metrics: metricsPerClub,
        dry_run: dryRun,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "Internal error", detail: msg }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function formatSwingSkippedAlert(tableName: string, retryCount: number): string {
  return `🚨 *Bàn ${tableName}* — Không có dealer thay sau ${retryCount} lần thử. Cần can thiệp thủ công!`;
}
