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
  type PoolSnapshot,
  type SwingConfig,
} from "./calculateBatchSwingDuration.ts";
import { pass2PreAssignNext } from "./passes/pass2-pre-assign.ts";
import { pass25InitialAssign } from "./passes/pass2.5-initial-assign.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STALE_PRE_ASSIGN_MINUTES = 20;       // Documentation: original threshold for stale pre-assign cleanup
const RECENT_PRE_ASSIGN_MINUTES = 10;      // Pre-assigns younger than this are valid, don't clear
const DEFAULT_PRE_ANNOUNCE_MINUTES = 6;
const DEFAULT_PRE_ASSIGN_WINDOW_MINUTES = 4;
const DEFAULT_MAX_WORK_MINUTES = 120;
const DEFAULT_MIN_WORK_MINUTES = 60;
const DEFAULT_SWING_DURATION_MINUTES = 30;
const DEFAULT_BREAK_DURATION_MINUTES = 15;
const SWING_WINDOW_BUFFER_MINUTES = 2;
const MAX_SWING_RETRIES = 3;

// ─── Dealer State Machine ─────────────────────────────────────────────────────
// Wrapper around transition_dealer_state RPC. Dùng cho individual operations.
// Batch cleanup (Pass 1b, 1c) dùng direct UPDATE — trigger ghi audit tự động.

interface StateTransitionResult {
  success: boolean;
  from?: string;
  to?: string;
  noop?: boolean;
  error?: string;
}

async function transitionDealerState(
  admin: ReturnType<typeof createClient>,
  attendanceId: string,
  newState: string,
  reason?: string
): Promise<StateTransitionResult> {
  try {
    const { data, error } = await admin.rpc("transition_dealer_state", {
      p_attendance_id: attendanceId,
      p_new_state: newState,
      p_reason: reason ?? null,
    });
    if (error) {
      console.error(`[state] ❌ RPC error ${attendanceId}: ${error.message}`);
      return { success: false, error: error.message };
    }
    if (!data || data.ok !== true) {
      console.error(
        `[state] ❌ FAILED ${attendanceId}: ${data?.from ?? "?"} → ${newState}` +
        ` (${data?.error ?? "unknown"})` + (reason ? ` reason=${reason}` : "")
      );
      return { success: false, from: data?.from, to: newState, error: data?.error ?? "transition failed" };
    }
    if (data.noop) {
      return { success: true, noop: true, from: data.from, to: data.to };
    }
    console.log(`[state] ✅ ${attendanceId}: ${data.from} → ${data.to}` + (reason ? ` (${reason})` : ""));
    return { success: true, from: data.from, to: data.to };
  } catch (err: any) {
    console.error(`[state] ❌ Exception ${attendanceId}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ─── Break settings cache ─────────────────────────────────────────────────────
const breakSettingsCache = new Map<string, { breakDuration: number; maxBreak: number; cachedAt: number }>();

async function getBreakSettings(
  admin: ReturnType<typeof createClient>,
  clubId: string
): Promise<{ breakDuration: number; maxBreak: number }> {
  const CACHE_TTL = 5 * 60 * 1000;
  const now = Date.now();
  const cached = breakSettingsCache.get(clubId);
  if (cached && now - cached.cachedAt < CACHE_TTL) {
    return { breakDuration: cached.breakDuration, maxBreak: cached.maxBreak };
  }

  const { data: clubCfg } = await admin
    .from("club_settings")
    .select("break_duration_minutes, max_break_duration_minutes")
    .eq("club_id", clubId)
    .maybeSingle();

  const breakDuration = Math.max(5, Math.min(60, clubCfg?.break_duration_minutes ?? 15));
  const maxBreak = Math.max(breakDuration, Math.min(120, clubCfg?.max_break_duration_minutes ?? 60));

  breakSettingsCache.set(clubId, { breakDuration, maxBreak, cachedAt: now });
  return { breakDuration, maxBreak };
}

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
      pre_assign_only: preAssignOnly = false,
      manual_window_minutes: manualWindowMinutes = 15,
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

        // ── PASS 0c: Detect & auto-fix stuck dealers ────────────────────────
        // Pre-fetch club dealer IDs (used by Pass 0c and seeding below)
        const { data: clubDealers } = await admin
          .from("dealers")
          .select("id")
          .eq("club_id", cid);
        const cidDealerIds = (clubDealers ?? []).map((d: { id: string }) => d.id);

        if (!dryRun) {
          const stuckIssues: Array<{ id: string; dealer_name: string; issue: string }> = [];

          // 1. Stuck pre_assigned (no table OR no timestamp — incomplete pre-assign)
          const { data: stuckPre } = await admin
            .from("dealer_attendance")
            .select(`
              id,
              dealer_id,
              current_state,
              pre_assigned_table_id,
              pre_assigned_at,
              dealers!inner(full_name)
            `)
            .eq("current_state", "pre_assigned")
            .or("pre_assigned_table_id.is.null,pre_assigned_at.is.null")
            .in("dealer_id", cidDealerIds);

          if (stuckPre && stuckPre.length > 0) {
            console.log(`[Pass 0c] Found ${stuckPre.length} stuck pre_assigned dealers (missing fields)`);
            for (const s of stuckPre) {
              const dealerName = (s.dealers as any)?.full_name ?? "Unknown";
              stuckIssues.push({
                id: s.id,
                dealer_name: dealerName,
                issue: `pre_assigned_incomplete: table=${s.pre_assigned_table_id ?? 'NULL'}, at=${s.pre_assigned_at ?? 'NULL'}`,
              });
              await transitionDealerState(admin, s.id, "available", "pass0c_stuck_pre_assigned_incomplete");
            }
          }

          // 1b. Orphaned pre_assigned (no active assignment pointing to them)
          const { data: orphanedPreAssigned } = await admin
            .from("dealer_attendance")
            .select(`
              id,
              dealer_id,
              pre_assigned_table_id,
              dealers!inner(full_name)
            `)
            .eq("current_state", "pre_assigned")
            .eq("status", "checked_in")
            .in("dealer_id", cidDealerIds);

          if (orphanedPreAssigned && orphanedPreAssigned.length > 0) {
            const { data: validPreAssigns } = await admin
              .from("dealer_assignments")
              .select("pre_assigned_attendance_id")
              .in("pre_assigned_attendance_id", orphanedPreAssigned.map((d: any) => d.id))
              .eq("status", "assigned")
              .is("released_at", null);

            const validPreIds = new Set(
              (validPreAssigns ?? []).map((a: any) => a.pre_assigned_attendance_id)
            );
            const toReleasePre = orphanedPreAssigned.filter(
              (d: any) => !validPreIds.has(d.id)
            );

            for (const dealer of toReleasePre) {
              const dealerName = (dealer.dealers as any)?.full_name ?? "Unknown";
              stuckIssues.push({
                id: dealer.id,
                dealer_name: dealerName,
                issue: "pre_assigned_orphaned_no_assignment",
              });
              await transitionDealerState(
                admin, dealer.id, "available",
                `pass0c_orphaned_pre_assigned_${dealer.pre_assigned_table_id ?? "none"}`
              );
              cycleExcludedIds.add(dealer.id);
              console.log(`[Pass 0c] Released orphaned pre_assigned dealer ${dealerName}`);
            }
          }

          // 2. Stuck on_break (overdue)
          const { data: stuckBreaks, error: breakErr } = await admin.rpc("detect_stuck_breaks", { p_club_id: cid });
          if (breakErr) {
            console.error("[Pass 0c] ❌ detect_stuck_breaks RPC failed:", breakErr);
          } else if (stuckBreaks && stuckBreaks.length > 0) {
            console.log(`[Pass 0c] Found ${stuckBreaks.length} stuck breaks (overdue)`);
            for (const b of stuckBreaks) {
              stuckIssues.push({ id: b.attendance_id, dealer_name: b.dealer_name, issue: `break_overdue_${b.overdue_min}m` });
              const { data: endResult, error: endErr } = await admin.rpc("end_dealer_break", {
                p_break_id: b.break_id,
                p_attendance_id: b.attendance_id,
              });
              if (endErr || endResult?.outcome !== "success") {
                console.error(`[Pass 0c] ❌ Failed to end stuck break ${b.break_id}:`, endErr?.message ?? endResult?.message);
              } else {
                console.log(`[Pass 0c] ✅ Auto-ended stuck break for ${b.dealer_name} (${b.overdue_min}m overdue)`);
              }
            }
          }

          // 3. Stuck in_transition (>5 minutes)
          // dealer_attendance has no updated_at — use check_in_time as proxy for time-based guard
          const { data: stuckTransition } = await admin
            .from("dealer_attendance")
            .select("id, dealer_id, check_in_time, dealers!inner(full_name)")
            .eq("current_state", "in_transition")
            .in("dealer_id", cidDealerIds)
            .lt("check_in_time", new Date(Date.now() - 5 * 60 * 1000).toISOString());

          if (stuckTransition && stuckTransition.length > 0) {
            console.log(`[Pass 0c] Found ${stuckTransition.length} stuck in_transition dealers (>5min)`);
            for (const s of stuckTransition) {
              const dealerName = (s.dealers as any)?.full_name ?? "Unknown";
              const stuckMinutes = Math.floor((Date.now() - new Date(s.check_in_time).getTime()) / 60000);
              stuckIssues.push({ id: s.id, dealer_name: dealerName, issue: `in_transition_stuck_${stuckMinutes}m` });
              await transitionDealerState(admin, s.id, "available", `pass0c_stuck_in_transition_${stuckMinutes}m`);
            }
          }

          // ── 4. Stuck assigned (no active assignment) ──────────────────────
          const { data: orphanedAssigned } = await admin
            .from("dealer_attendance")
            .select(`
              id,
              dealer_id,
              check_in_time,
              dealers!inner(full_name)
            `)
            .eq("current_state", "assigned")
            .eq("status", "checked_in")
            .in("dealer_id", cidDealerIds);

          if (orphanedAssigned && orphanedAssigned.length > 0) {
            const { data: activeAssignments } = await admin
              .from("dealer_assignments")
              .select("attendance_id")
              .in("attendance_id", orphanedAssigned.map((d: any) => d.id))
              .eq("status", "assigned")
              .is("released_at", null);

            const activeIds = new Set((activeAssignments ?? []).map((a: any) => a.attendance_id));
            const toRelease = orphanedAssigned.filter((d: any) => !activeIds.has(d.id));

            for (const dealer of toRelease) {
              const dealerName = (dealer.dealers as any)?.full_name ?? "Unknown";
              const stuckMinutes = Math.floor(
                (Date.now() - new Date(dealer.check_in_time).getTime()) / 60000
              );
              stuckIssues.push({
                id: dealer.id,
                dealer_name: dealerName,
                issue: `assigned_orphaned_${stuckMinutes}m`,
              });
              await transitionDealerState(
                admin, dealer.id, "available",
                `pass0c_orphaned_assigned_stuck_${stuckMinutes}m`
              );
              cycleExcludedIds.add(dealer.id);
              console.log(`[Pass 0c] Released orphaned dealer ${dealerName} (was: assigned, stuck: ${stuckMinutes}m)`);
            }
          }

          // 5. Telegram notification
          if (stuckIssues.length > 0) {
            console.warn(`[Pass 0c] ⚠️ Found ${stuckIssues.length} stuck dealers (auto-fixed)`);
            const chatId = await getClubTelegramChatId(admin, cid);
            if (botToken && chatId) {
              const msg = `⚠️ *${stuckIssues.length} dealer bị treo — đã tự động sửa*\n\n` +
                stuckIssues.slice(0, 10).map(s => `  • *${s.dealer_name}*: ${s.issue}\n    \`${s.id.slice(0, 8)}…\``).join("\n") +
                (stuckIssues.length > 10 ? `\n\n_...và ${stuckIssues.length - 10} dealers khác_` : "") +
                `\n\n🔍 Kiểm tra \`dealer_state_transitions\` để biết chi tiết.`;
              await sendTelegramNotification(botToken, chatId, msg, { parse_mode: "Markdown" });
            }
          } else {
            console.log("[Pass 0c] ✅ No stuck dealers found");
          }

          // 6. Phase 4: Critically overdue + extended OT alerting
          // Detects conditions that Pass 3 cannot catch proactively:
          //   - swing_due_at > 30 min in the past (Pass 3 only catches window [now, now+2min])
          //   - overtime_started_at > 45 min ago (extended OT needs floor intervention)
          // These alert the floor WITHOUT auto-fix (dealers may be in legitimate process).
          const overdueThreshold = new Date(Date.now() - 30 * 60_000).toISOString();
          const { data: overdueAssignments, error: overdueErr } = await admin
            .from("dealer_assignments")
            .select(`
              id, table_id, swing_due_at, overtime_started_at,
              game_tables(table_name),
              dealer_attendance!attendance_id(dealers(full_name))
            `)
            .eq("club_id", cid)
            .eq("status", "assigned")
            .is("swing_processed_at", null)
            .lt("swing_due_at", overdueThreshold);

          const otThreshold = new Date(Date.now() - 45 * 60_000).toISOString();
          const { data: extendedOtAssignments, error: otErr } = await admin
            .from("dealer_assignments")
            .select(`
              id, table_id, overtime_started_at,
              game_tables(table_name),
              dealer_attendance!attendance_id(dealers(full_name))
            `)
            .eq("club_id", cid)
            .eq("status", "assigned")
            .is("swing_processed_at", null)
            .not("overtime_started_at", "is", null)
            .lt("overtime_started_at", otThreshold);

          const criticalAlerts: string[] = [];

          if (overdueErr) {
            console.error("[Pass 0c] ❌ Overdue query error:", overdueErr.message);
          } else if (overdueAssignments && overdueAssignments.length > 0) {
            console.warn(`[Pass 0c] ⚠️ Found ${overdueAssignments.length} critically overdue assignments (>30 min)`);
            for (const a of overdueAssignments) {
              const overdueMin = Math.floor(
                (Date.now() - new Date(a.swing_due_at).getTime()) / 60_000
              );
              const tableName = (a.game_tables as any)?.table_name ?? a.table_id;
              const dealerName = (a.dealer_attendance as any)?.dealers?.full_name ?? "Unknown";
              criticalAlerts.push(`🔴 *Bàn ${tableName}* — Dealer ${dealerName}: swing_due_at QUÁ HẠN ${overdueMin}ph. Cần xử lý ngay!`);
            }
          }

          if (otErr) {
            console.error("[Pass 0c] ❌ Extended OT query error:", otErr.message);
          } else if (extendedOtAssignments && extendedOtAssignments.length > 0) {
            console.warn(`[Pass 0c] ⚠️ Found ${extendedOtAssignments.length} extended OT assignments (>45 min)`);
            for (const a of extendedOtAssignments) {
              const otMin = Math.floor(
                (Date.now() - new Date(a.overtime_started_at).getTime()) / 60_000
              );
              const tableName = (a.game_tables as any)?.table_name ?? a.table_id;
              const dealerName = (a.dealer_attendance as any)?.dealers?.full_name ?? "Unknown";
              criticalAlerts.push(`⏱ *Bàn ${tableName}* — Dealer ${dealerName}: OT ${otMin}ph (extended). Cần can thiệp!`);
            }
          }

          if (criticalAlerts.length > 0) {
            const chatId = await getClubTelegramChatId(admin, cid);
            if (botToken && chatId) {
              const msg = `🚨 *${criticalAlerts.length} cảnh báo nghiêm trọng*\n\n` +
                criticalAlerts.slice(0, 10).join("\n\n") +
                (criticalAlerts.length > 10 ? `\n\n_...và ${criticalAlerts.length - 10} cảnh báo khác_` : "") +
                `\n\n🔍 Cron sẽ thử lại ở lần chạy tiếp theo. Nếu không tự giải quyết, kiểm tra pool dealer.`;
              await sendTelegramNotification(botToken, chatId, msg, { parse_mode: "Markdown" });
            }
          } else {
            console.log("[Pass 0c] ✅ No critically overdue or extended OT assignments");
          }
        }

        // ── SEED: Pre-assigned dealers from previous ticks ──────────────────
        // Without this, two ticks can pre-assign the same dealer because
        // cycleExcludedIds only accumulates within a single tick. Seeding
        // with already-committed pre-assigned dealers prevents double-assignment.
        if (!dryRun) {
          const { data: preAssignedDealers } = await admin
            .from("dealer_attendance")
            .select("id")
            .eq("current_state", "pre_assigned")
            .eq("status", "checked_in")
            .in("dealer_id", cidDealerIds);

          if (preAssignedDealers && preAssignedDealers.length > 0) {
            for (const d of preAssignedDealers) cycleExcludedIds.add(d.id);
            console.log(`[process-swing] Seeded ${preAssignedDealers.length} pre-assigned dealers into cycleExcludedIds for club ${cid}`);
          }
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
        // Only clear pre-assigns older than RECENT_PRE_ASSIGN_MINUTES (10 min).
        // This prevents clearing a pre-assign that was just set in the current
        // or previous tick. The 10-min buffer accounts for clock skew and
        // long-running tick processing.
        const recentThreshold = new Date(
          Date.now() - RECENT_PRE_ASSIGN_MINUTES * 60 * 1000
        ).toISOString();

        const { data: staleRows } = await admin
          .from("dealer_assignments")
          .select("id, pre_assigned_attendance_id")
          .eq("status", "assigned")
          .not("pre_assigned_attendance_id", "is", null)
          .lt("pre_assigned_at", recentThreshold)
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
            console.log(`[Pass 1b] Releasing ${staleAttendanceIds.length} stale pre-assigned dealers...`);
            let releaseOk = 0;
            let releaseFail = 0;
            for (const attId of staleAttendanceIds) {
              const result = await transitionDealerState(
                admin, attId, "available", "pass1b_release_stale_pre_assign"
              );
              if (!result.success) {
                releaseFail++;
                if (releaseFail <= 3) console.error(`[Pass 1b] transitionDealerState failed for ${attId}:`, result.error);
                continue;
              }
              await admin.from("dealer_attendance")
                .update({ pre_assigned_table_id: null, pre_assigned_at: null })
                .eq("id", attId);
              releaseOk++;
            }
            if (releaseFail > 0) {
              console.error(`[Pass 1b] ❌ Released ${releaseOk}/${staleAttendanceIds.length} dealers (${releaseFail} failed)`);
            } else {
              console.log(`[Pass 1b] ✅ All ${releaseOk} stale pre-assigned dealers released with context`);
            }
          } else {
            console.log(`[Pass 1b] ✅ Cleaned ${staleRows.length} stale pre_assign records for club ${cid}`);
          }
        }

        // ── Pass 1c: Release orphaned pre_assigned (no table, no assignment) ──
        if (cidDealerIds.length > 0) {
          const { data: orphanedAttendances } = await admin
            .from("dealer_attendance")
            .select("id")
            .eq("current_state", "pre_assigned")
            .is("pre_assigned_table_id", null)
            .in("dealer_id", cidDealerIds);
          if (orphanedAttendances && orphanedAttendances.length > 0) {
            const orphanIds = orphanedAttendances.map((r: { id: string }) => r.id);
            console.log(`[Pass 1c] Releasing ${orphanIds.length} orphaned pre_assigned dealers...`);
            let releaseOk = 0;
            let releaseFail = 0;
            for (const attId of orphanIds) {
              const result = await transitionDealerState(
                admin, attId, "available", "pass1c_release_orphan_pre_assign"
              );
              if (!result.success) {
                releaseFail++;
                if (releaseFail <= 3) console.error(`[Pass 1c] transitionDealerState failed for ${attId}:`, result.error);
                continue;
              }
              await admin.from("dealer_attendance")
                .update({ pre_assigned_table_id: null, pre_assigned_at: null })
                .eq("id", attId);
              releaseOk++;
            }
            if (releaseFail > 0) {
              console.error(`[Pass 1c] ❌ Released ${releaseOk}/${orphanIds.length} orphans (${releaseFail} failed)`);
            } else {
              console.log(`[Pass 1c] ✅ All ${releaseOk} orphaned dealers released with pass1c context`);
            }
          }
        }

        // ── PASS 2 — Pre-assign incoming dealers ────────────────────────
        // Uses pickNextDealer + CAS RPC to atomically pre-assign dealers
        // for tables whose swing due falls within the pre-announce window.
        // forceAll: skip pre-assign to preserve dealer pool for backlog processing.
        if (!forceAll) {
          const pass2Options: Parameters<typeof pass2PreAssignNext>[3] = {
            clubZone,
            notifier,
            cycleExcludedIds,
            botToken: botToken ?? "",
          };
          if (preAssignOnly) {
            pass2Options.manualWindowMinutes = manualWindowMinutes;
          }
          const pass2Result = await pass2PreAssignNext(
            admin, cid, clubCfg.pre_announce_minutes,
            pass2Options,
          );
          if (pass2Result.pre_assigned_count > 0) {
            console.log(`[Pass 2] ✅ Pre-assigned ${pass2Result.pre_assigned_count} dealers`);
          }
          metrics.total += pass2Result.pre_assigned_count;
          metrics.success += pass2Result.pre_assigned_count;
        }

        if (preAssignOnly) {
          console.log(`[process-swing] pre_assign_only mode — skipping Pass 2.5+ for club ${cid}`);
          continue;
        }

        // ── PASS 2.5 — Assign initial dealers to empty assignments ──────
        // Catches assignments that have status='assigned' but dealer_id=NULL.
        // This happens when the initial creation sets attendance_id but
        // dealer_id was never linked (e.g. pre-assign succeeded but the
        // subsequent swing that writes dealer_id failed).
        // Runs after Pass 2 so pre-assigned dealers get priority.
        {
          const pass25Result = await pass25InitialAssign(
            admin, cid, cycleExcludedIds, required_game_types,
          );
          if (pass25Result.assigned_count > 0) {
            console.log(`[Pass 2.5] ✅ Assigned ${pass25Result.assigned_count} initial dealers`);
          }
        }

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
             game_tables(table_name, table_type),
             dealer_attendance!attendance_id(dealers(full_name, telegram_username, telegram_user_id))`
          )
          .eq("status", "assigned")
          .is("swing_processed_at", null)
          .eq("club_id", cid);  // Phase 1: use denormalized club_id (NOT NULL + indexed)

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
          (a: any, b: any) => {
            const aOt = a.overtime_started_at ? 1 : 0;
            const bOt = b.overtime_started_at ? 1 : 0;
            if (aOt !== bOt) return bOt - aOt;
            return new Date(a.swing_due_at).getTime() - new Date(b.swing_due_at).getTime();
          }
        );

        const validatedBreakDuration = clubCfg.break_duration_minutes == null
          ? DEFAULT_BREAK_DURATION_MINUTES
          : Math.max(5, Math.min(60, clubCfg.break_duration_minutes));

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

          // ── CIRCUIT BREAKER: Stuck swing detection ─────────────────────────
          // If swing is overdue by > 60 minutes, this is likely an infinite retry
          // loop caused by stale dealer pool (bug #1) or TOCTOU race (bug #2).
          // Mark swing_processed_at to break the loop and alert admins.
          const OVERDUE_CIRCUIT_BREAKER_MINUTES = 60;
          if (minsLeft < -OVERDUE_CIRCUIT_BREAKER_MINUTES) {
            console.error(
              `[process-swing] 🚨 CIRCUIT BREAKER: Table ${tableName} assignment ${assignment.id} ` +
              `overdue by ${-minsLeft} min. Breaking loop.`
            );
            if (!dryRun) {
              await admin
                .from("dealer_assignments")
                .update({
                  swing_processed_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", assignment.id);
              const chatId = await getClubTelegramChatId(admin, cid);
              if (botToken && chatId) {
                await sendTelegramNotification(
                  botToken, chatId,
                  `🚨 *CIRCUIT BREAKER* — Bàn ${tableName} (${outgoingDealer.full_name}) quá hạn swing ${-minsLeft}ph.\nĐã dừng vòng lặp. Cần can thiệp thủ công ngay!`,
                  {}
                );
              }
            }
            metrics.failed++;
            continue;
          }

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
                p_old_assignment_id:    assignment.id,
                p_next_attendance_id:   assignment.pre_assigned_attendance_id,
                p_swing_due_at:         pass3SwingDueAt,
                p_duration_minutes:     swingDurResult.durationMinutes,
                p_send_to_break:        breakDecision.shouldBreak,
                p_break_duration_minutes: validatedBreakDuration,
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
                  const { breakDuration: fbBreakDuration } = await getBreakSettings(admin, cid);
                  const { data: fbResult } = await admin.rpc("perform_swing", {
                    p_assignment_id: assignment.id,
                    p_duration_minutes: swingDurResult.durationMinutes,
                    p_send_to_break: fbBreakDecision.shouldBreak,
                    p_break_duration_minutes: fbBreakDuration,
                    p_expected_version: freshRow.version,
                    p_next_attendance_id: fbDealer.id,
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
                  const { breakDuration: otBreakDur } = await getBreakSettings(admin, cid);
                  const { data: otResult } = await admin.rpc("perform_swing", {
                    p_assignment_id: assignment.id,
                    p_duration_minutes: swingDurResult.durationMinutes,
                    p_send_to_break: false,
                    p_break_duration_minutes: otBreakDur,
                    p_expected_version: freshRow.version,
                    p_next_attendance_id: null,
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

            // Compute OT minutes for escalation threshold check
            const otMinutes = isOtDealer && (assignment as any).overtime_started_at
              ? Math.floor((Date.now() - new Date((assignment as any).overtime_started_at).getTime()) / 60000)
              : 0;

            // Shared base options for all pick attempts
            const basePickOptions = {
              currentTableId: assignment.table_id,
              excludeAttendanceIds: nextExcludes,
              requiredGameTypes: required_game_types,
              clubBreakDurationMinutes: clubCfg.break_duration_minutes,
            };

            // ── Level 1: Normal pick ─────────────────────────────────────────
            // All filters active, priority break flag respected.
            let nextDealer = await pickNextDealer(admin, cid, basePickOptions);

            // ── Level 2: Relax priority break guard (OT first attempt) ────────
            // When no dealer found and table is OT, skip priority_break_flag
            // filter so dealers flagged for break but well-rested are eligible.
            if (!nextDealer && isOtDealer) {
              console.log(
                `[process-swing] Level 2 fallback for ${tableName} ` +
                `(OT ${otMinutes}min): relaxing priority break guard`
              );
              nextDealer = await pickNextDealer(admin, cid, {
                ...basePickOptions,
                skipPriorityBreakGuard: true,
              });
            }

            // ── Level 3: Relax fatigue hard cap (extended OT only) ────────────
            // When OT extends beyond escalation threshold (default 20 min),
            // also relax the 105-min fatigue hard cap so heavily worked dealers
            // can still be picked as absolute last resort.
            const escalationThreshold = 20;
            if (!nextDealer && isOtDealer && otMinutes >= escalationThreshold) {
              console.warn(
                `[process-swing] Level 3 fallback for ${tableName} ` +
                `(OT ${otMinutes}min): relaxing fatigue cap — last resort`
              );
              nextDealer = await pickNextDealer(admin, cid, {
                ...basePickOptions,
                skipPriorityBreakGuard: true,
                skipFatigueHardCap: true,
              });
            }

            // ── Log desperate pick for floor visibility ──────────────────────
            if (nextDealer && isOtDealer && otMinutes > 0) {
              console.warn(
                `[process-swing] Desperate pick for OT table ${tableName}: ` +
                `assigned ${nextDealer.full_name} ` +
                `(worked ${nextDealer.worked_minutes_since_last_break}min, ` +
                `priorityBreak=${nextDealer.priority_break_flag})`
              );
              // Send Telegram alert if this was Level 3 (extended OT)
              if (otMinutes >= escalationThreshold) {
                const chatId = botToken ? await getClubTelegramChatId(admin, cid).catch(() => null) : null;
                if (botToken && chatId) {
                  await sendTelegramNotification(
                    botToken, chatId,
                    `⚠️ *Bàn ${tableName}* — Cấp cứu OT ${otMinutes}ph: đã gán ${nextDealer.full_name} theo luật nới lỏng.\nCần theo dõi sát!`,
                    {}
                  ).catch(() => {});
                }
              }
            }

                // SAFEGUARD: verify dealer belongs to this club before assigning
            if (nextDealer?.id) {
              let dealerClub: { club_id: string } | null = null;
              try {
                const res = await admin
                  .from("dealers")
                  .select("club_id")
                  .eq("id", nextDealer.dealer_id)
                  .single();
                dealerClub = res.data;
              } catch { /* ignore */ }
              if (!dealerClub || dealerClub.club_id !== cid) {
                console.warn(`[process-swing] SAFEGUARD: dealer ${nextDealer.full_name} club ${dealerClub?.club_id} != table club ${cid}, skipping`);
                const safeguardResult = await transitionDealerState(
                  admin,
                  nextDealer.id,
                  "available",
                  `safeguard_club_mismatch_table_${assignment.table_id}`
                );
                if (!safeguardResult.success) {
                  console.error(`[Pass 3] ❌ Safeguard failed to release dealer ${nextDealer.id}:`, safeguardResult.error);
                }
                continue;
              }
            }

            const { breakDuration: pBreakDuration } = await getBreakSettings(admin, cid);
            const { data: swingResult } = await admin.rpc("perform_swing", {
              p_assignment_id: assignment.id,
              p_duration_minutes: swingDurResult.durationMinutes,
              p_send_to_break: breakDecision.shouldBreak,
              p_break_duration_minutes: pBreakDuration,
              p_expected_version: assignment.version,
              p_next_attendance_id: nextDealer?.id ?? null,
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
              console.warn(
                `[process-swing] no_dealer for ${tableName}: ` +
                `level=${isOtDealer ? (otMinutes >= 20 ? 3 : 2) : 1} ` +
                `nextDealer=${nextDealer?.id ?? "null"} ` +
                `retry=${swingResult?.retry_attempts ?? 0}`
              );
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

                  try {
                    await admin
                      .from("dealer_assignments")
                      .update({ last_ot_alert_at: new Date().toISOString() })
                      .eq("id", assignment.id);
                  } catch (e: unknown) {
                    console.error("[process-swing] last_ot_alert_at update failed:", e instanceof Error ? e.message : e);
                  }
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

        // ── PASS 4b — Refresh dealer pool summary (monitoring) ────────────
        if (!dryRun) {
          console.log("[Pass 4b] 🔄 Refreshing dealer pool summary...");
          const poolStartTime = Date.now();
          try {
            const { error: refreshErr } = await admin.rpc("refresh_dealer_pool_summary");
            if (refreshErr) {
              console.warn("[Pass 4b] ⚠️ Pool summary refresh failed:", refreshErr.message);
            } else {
              console.log(`[Pass 4b] ✅ Pool summary refreshed (${Date.now() - poolStartTime}ms)`);
            }
          } catch (err: any) {
            console.warn("[Pass 4b] ⚠️ Pool summary refresh exception:", err.message);
          }
        }

        // ── SHORTAGE ESCALATION ──────────────────────────────────────────
        if (!dryRun && metrics.total > 0 && metrics.failed === 0) {
          const noDealerRatio = metrics.no_dealer / metrics.total;
          if (noDealerRatio > 0.5 && metrics.no_dealer >= 3) {
            console.warn(
              `[Shortage] ⚠️ Club ${cid}: no_dealer=${metrics.no_dealer}/${metrics.total} ` +
              `(${(noDealerRatio * 100).toFixed(1)}%)`
            );

            const { data: settingsRow } = await admin
              .from("club_settings")
              .select("shortage_auto_close_enabled, shortage_close_threshold, shortage_notify_telegram")
              .eq("club_id", cid)
              .maybeSingle();

            const autoCloseEnabled = (settingsRow as any)?.shortage_auto_close_enabled ?? false;
            const closeThreshold = (settingsRow as any)?.shortage_close_threshold ?? 4;
            const notifyTelegram = (settingsRow as any)?.shortage_notify_telegram ?? true;

            let closedTables: Array<{ table_id: string; table_name: string }> = [];

            if (autoCloseEnabled && metrics.no_dealer >= closeThreshold) {
              console.log(`[Shortage] Auto-closing low-priority tables (no_dealer=${metrics.no_dealer} >= threshold=${closeThreshold})...`);
              try {
                const { data: closeResult, error: closeErr } = await admin.rpc(
                  "auto_close_low_priority_tables", { p_club_id: cid }
                );
                if (closeErr) {
                  console.error("[Shortage] ❌ auto_close_low_priority_tables RPC failed:", closeErr);
                } else if (closeResult && closeResult.length > 0) {
                  closedTables = closeResult;
                  console.log(`[Shortage] ✅ Auto-closed ${closedTables.length} tables:`, closedTables.map((t: any) => t.table_name).join(", "));
                }
              } catch (err: any) {
                console.error("[Shortage] ❌ Exception during auto-close:", err.message);
              }
            }

            if (notifyTelegram) {
              const chatId = await getClubTelegramChatId(admin, cid);
              if (botToken && chatId) {
                let msg = `🚨 *THIẾU DEALER* — ${metrics.no_dealer}/${metrics.total} bàn không có người thay.\n\n`;
                if (closedTables.length > 0) {
                  msg += `🔴 *Đã tự động đóng ${closedTables.length} bàn:*\n` +
                    closedTables.map((t: any) => `  • ${t.table_name}`).join("\n") + `\n\n`;
                } else if (autoCloseEnabled && metrics.no_dealer >= closeThreshold) {
                  msg += `⚠️ Auto-close enabled nhưng không có bàn low-priority.\n\n`;
                } else if (autoCloseEnabled) {
                  msg += `⏳ Auto-close enabled nhưng chưa đạt threshold (${metrics.no_dealer}/${closeThreshold}).\n\n`;
                }
                msg += `💡 *Khuyến nghị:*\n  • Check-in thêm dealers\n  • Hoặc đóng bàn thủ công\n\n🔄 Cron sẽ thử lại ở lần chạy tiếp theo.`;
                await sendTelegramNotification(botToken, chatId, msg, { parse_mode: "Markdown" });
              }
            }
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
