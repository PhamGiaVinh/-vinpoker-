# Swing Progress Flow — Tài liệu đầy đủ

> **Mục đích**: Mô tả toàn bộ luồng swing của VinPoker, từ cron trigger đến khi dealer được swing và break kết thúc.

---

## Tổng quan kiến trúc

```
pg_cron (30s) → process-swing (Deno) → club-level lock → 7 passes
                                    → process-pre-announce-jobs (Deno, 30s) → Telegram
```

Thứ tự các Pass trong mỗi lần chạy `process-swing`:

| Pass | Tên | Chức năng |
|------|-----|-----------|
| 0 | Batch Duration | Tính toán swing duration động từ pool snapshot |
| 0b | Available Count | Đếm số dealer available (break deadlock guard) |
| 0c | Stuck Detection | Auto-fix dealer bị treo (stuck pre_assigned, broken break, orphaned assigned) |
| 0d | State Reconciliation | Đồng bộ dealer_attendance với dealer_assignments |
| 0e | Meal Break Auto-end | Kết thúc meal break quá hạn |
| 1 | Fill Empty Tables | Gán dealer cho bàn chưa có ai |
| 1b | Stale Pre-assign Cleanup | 3-tier circuit breaker: critical (4h+) / stale (60m+) / safeguard |
| 1c | Orphaned Pre-assign Release | Giải phóng pre_assigned không có table/assignment |
| 1.5 | Rotation Planner | Greedy solver cho batch pre-assign (feature-flagged) |
| 2 | Pre-assign | pickNextDealer + CAS RPC cho bàn sắp đến giờ swing |
| 2.5 | Initial Assign | Gán dealer cho assignment có dealer_id=NULL |
| 3 | Execute Swing | Thực thi swing (pre-assigned path + non-pre-assigned path + graduated escalation) |
| 4 | End Expired Breaks | Kết thúc break đã hết hạn |
| 4b | Refresh Pool Summary | Refresh materialized view |

---

## File cấu trúc

```
supabase/functions/
├── process-swing/
│   ├── index.ts                    # Main orchestrator (3297 dòng)
│   ├── calculateBatchSwingDuration.ts
│   ├── diagnostics.ts
│   └── passes/
│       ├── pass1.5-rotation-planner.ts
│       ├── pass2-pre-assign.ts
│       ├── pass2.5-initial-assign.ts
│       └── pass3-post-swing-assign.ts
├── process-pre-announce-jobs/
│   └── index.ts                    # Telegram queue processor (430 dòng)
├── _shared/
│   ├── pickNextDealer.ts           # Core dealer selection (896 dòng)
│   ├── dealer-utils.ts             # Re-exports
│   ├── preAssignTelegram.ts        # Telegram notification formatting
│   ├── telegramNotifier.ts         # Batch Telegram notifier
│   └── ...
└── ...
```

---

## 1. process-swing/index.ts — Main Orchestrator

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  pickNextDealer,
  evaluateBreakNeed,
  computeSwingDuration,
  computeNextSwingAt,
  fillEmptyTables,
  getTableIdsForClub,
} from "../_shared/dealer-utils.ts";
import { buildDealerCandidates } from "../_shared/pickNextDealer.ts";
import {
  sendTelegramNotification,
  getClubTelegramChatId,
  formatMassAssignMessage,
  formatEmergencyPreAssignMessage,
  notifyFloorManagerDM,
} from "../_shared/telegram.ts";
import { TelegramNotifier } from "../_shared/telegramNotifier.ts";
import type {
  BreakStartEvent,
} from "../_shared/telegramNotifier.ts";
import {
  calculateBatchSwingDuration,
  resolveSwingConfig,
  type PoolSnapshot,
  type SwingConfig,
} from "./calculateBatchSwingDuration.ts";
import { pass2PreAssignNext } from "./passes/pass2-pre-assign.ts";
import { pass25InitialAssign } from "./passes/pass2.5-initial-assign.ts";
import { pass15RotationPlanner } from "./passes/pass1.5-rotation-planner.ts";
import { postSwingPreAssign } from "./passes/pass3-post-swing-assign.ts";
import { runPass3Diagnostic } from "./diagnostics.ts";
import { endMealBreak } from "../_shared/mealBreakService.ts";
import {
  ZOMBIE_LOCK_WINDOW_MS,
  derivePreAssignStatus,
  sortPass3Candidates,
} from "../_shared/preAssignState.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SWING_THRESHOLDS = {
  OVERDUE_THRESHOLD_MINUTES: 60,
  CRITICALLY_OVERDUE_HOURS: 4,
  BASE_LOCK_TIMEOUT_SECONDS: 120,
  LOCK_TIMEOUT_PER_TABLE: 10,
  MAX_LOCK_TIMEOUT_SECONDS: 300,
  RELEASE_BATCH_SIZE: 50,
  MAX_ERRORS_TO_LOG: 3,
  ALERT_THROTTLE_HOURS: 1,
  ROLLBACK_MAX_RETRIES: 3,
  ROLLBACK_BASE_BACKOFF_MS: 100,
  ROLLBACK_MAX_BACKOFF_MS: 5000,
  BULK_CLEAR_MAX_RETRIES: 3,
  BULK_CLEAR_BASE_BACKOFF_MS: 200,
} as const;

const DEFAULT_PRE_ANNOUNCE_MINUTES = 6;
const DEFAULT_PRE_ASSIGN_WINDOW_MINUTES = 4;
const DEFAULT_MAX_WORK_MINUTES = 120;
const DEFAULT_MIN_WORK_MINUTES = 60;
const DEFAULT_SWING_DURATION_MINUTES = 30;
const DEFAULT_BREAK_DURATION_MINUTES = 15;
const SWING_WINDOW_BUFFER_MINUTES = 2;
const MAX_SWING_RETRIES = 3;
```

### State transition helper

```typescript
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
```

### Break settings cache

```typescript
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
```

### Club Config types & fetching

```typescript
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
  rotation_planner_enabled: boolean;
  min_inter_swing_rest_minutes: number;
}

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
      rotation_planner_enabled: row.rotation_planner_enabled ?? false,
      min_inter_swing_rest_minutes: row.min_inter_swing_rest_minutes ?? 10,
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
      rotation_planner_enabled: false,
      min_inter_swing_rest_minutes: 10,
    }
  );
}
```

### Main handler — Deno.serve

```typescript
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

    const executionStartTime = Date.now();
    let clubsProcessed = 0;
    let clubsSkippedLocked = 0;
    let clubsSkippedError = 0;

    // ═══════════════════════════════════════════════════════════════════════════
    //  Process each club independently with club-level locking
    // ═══════════════════════════════════════════════════════════════════════════
    for (const cid of clubIds) {
      let lockAcquired = false;

      // ── Acquire club processing lock ────────────────────────────
      try {
        const { data: lockResult, error: lockErr } = await admin.rpc("try_acquire_club_lock", {
          p_club_id: cid,
          p_timeout_seconds: SWING_THRESHOLDS.BASE_LOCK_TIMEOUT_SECONDS,
        });

        if (lockErr) {
          console.error(`[process-swing] ❌ Lock RPC failed for ${cid}:`, lockErr.message);
          clubsSkippedError++;
          continue;
        }

        if (!lockResult || typeof lockResult !== "object" || !("acquired" in lockResult)) {
          console.error(`[process-swing] ❌ Invalid lock result for ${cid}:`, JSON.stringify(lockResult));
          clubsSkippedError++;
          continue;
        }

        const acquired = (lockResult as LockAcquisitionResult).acquired === true;
        if (!acquired) {
          console.log(`[process-swing] 🔒 Club ${cid} locked by another instance`);
          clubsSkippedLocked++;
          continue;
        }

        lockAcquired = true;
      } catch (err) {
        console.error(`[process-swing] ❌ Lock acquisition exception for ${cid}:`, err);
        clubsSkippedError++;
        continue;
      }

      try {
        // ── Guard: club config ───────────────────────────────
        let clubCfg: ClubSwingConfig;
        try {
          clubCfg = getClubConfig(allClubConfigs, cid);
        } catch (err) {
          console.error(`[process-swing] ❌ Failed to get config for club ${cid}:`, err);
          clubsSkippedError++;
          continue;
        }

        if (!manualTrigger && !clubCfg.auto_swing_enabled) {
          console.log(`[process-swing] Club ${cid} auto-swing disabled — skipping`);
          continue;
        }

        if (!metricsPerClub[cid]) {
          metricsPerClub[cid] = { total: 0, success: 0, failed: 0, no_dealer: 0, tg_failed: 0, skipped: 0 };
        }
        const metrics = metricsPerClub[cid];

        // ── Cache table IDs once per club ─────────────────────────
        let clubTableIds: string[];
        try {
          clubTableIds = await getTableIdsForClub(admin, cid);
        } catch (err) {
          console.error(`[process-swing] ❌ getTableIdsForClub failed for club ${cid}:`, err);
          clubsSkippedError++;
          continue;
        }

        const cycleExcludedIds = new Set<string>();

        // ── TelegramNotifier for this club cycle ──────────────────────────
        let notifier: TelegramNotifier | null = null;
        let clubZone: string | null = null;
        let pass2ChatId: string | null = null;
        if (botToken) {
          const [chatId, zoneData] = await Promise.all([
            getClubTelegramChatId(admin, cid),
            admin.from("swing_config").select("club_zone").eq("club_id", cid).maybeSingle(),
          ]);
          pass2ChatId = chatId;
          if (chatId) {
            notifier = new TelegramNotifier(botToken, chatId);
            clubZone = (zoneData as any)?.club_zone ?? null;
          }
        }
```

### Pass 0 — Batch swing duration from pool snapshot

```typescript
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

        // Pre-fetch club dealer IDs
        console.log(`[process-swing] Club ${cid}: querying dealers...`);
        let cidDealerIds: string[];
        try {
          const { data: clubDealers } = await admin
            .from("dealers")
            .select("id")
            .eq("club_id", cid);
          cidDealerIds = (clubDealers ?? []).map((d: { id: string }) => d.id);
        } catch (err) {
          console.error(
            `[process-swing] ❌ Dealer query failed for club ${cid}:`,
            err instanceof Error ? err.stack : err
          );
          continue;
        }

        if (cidDealerIds.length === 0) {
          console.log(`[process-swing] No dealers for club ${cid} — skipping`);
          continue;
        }
```

### Pass 0b — Available dealer count

```typescript
        // ── PASS 0b — Query available dealer count for break deadlock guard ──
        let availableDealerCount: number | undefined;
        if (!dryRun) {
          const { count } = await admin
            .from("dealer_attendance")
            .select("id", { head: true, count: "exact" })
            .in("dealer_id", cidDealerIds)
            .eq("current_state", "available")
            .eq("status", "checked_in");
          availableDealerCount = count ?? 0;
        }
```

### Pass 0c — Stuck dealer detection & auto-fix

```typescript
        // ── PASS 0c: Detect & auto-fix stuck dealers ────────────────────────
        if (!dryRun) {
          const stuckIssues: Array<{ id: string; dealer_name: string; issue: string }> = [];

          // 1. Stuck pre_assigned (no table OR no timestamp)
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
            }
          }

          // 2. Stuck on_break (overdue)
          const { data: stuckBreaks, error: breakErr } = await admin.rpc("detect_stuck_breaks", { p_club_id: cid });
          if (breakErr) {
            console.error("[Pass 0c] ❌ detect_stuck_breaks RPC failed:", breakErr);
          } else if (stuckBreaks && stuckBreaks.length > 0) {
            for (const b of stuckBreaks) {
              if (b.overdue_min > 5) {
                stuckIssues.push({ id: b.attendance_id, dealer_name: b.dealer_name, issue: `break_overdue_${b.overdue_min}m` });
              }
              const { data: endResult, error: endErr } = await admin.rpc("end_dealer_break", {
                p_break_id: b.break_id,
                p_attendance_id: b.attendance_id,
              });
              if (endErr || endResult?.outcome !== "success") {
                console.error(`[Pass 0c] ❌ Failed to end stuck break ${b.break_id}:`, endErr?.message ?? endResult?.message);
              }
            }
          }

          // 3. Stuck in_transition (>5 minutes)
          const { data: stuckTransition } = await admin
            .from("dealer_attendance")
            .select("id, dealer_id, check_in_time, dealers!inner(full_name)")
            .eq("current_state", "in_transition")
            .in("dealer_id", cidDealerIds)
            .lt("check_in_time", new Date(Date.now() - 5 * 60 * 1000).toISOString());

          if (stuckTransition && stuckTransition.length > 0) {
            for (const s of stuckTransition) {
              const dealerName = (s.dealers as any)?.full_name ?? "Unknown";
              const stuckMinutes = Math.floor((Date.now() - new Date(s.check_in_time).getTime()) / 60000);
              stuckIssues.push({ id: s.id, dealer_name: dealerName, issue: `in_transition_stuck_${stuckMinutes}m` });
              await transitionDealerState(admin, s.id, "available", `pass0c_stuck_in_transition_${stuckMinutes}m`);
            }
          }

          // 4. Stuck assigned (no active assignment)
          const { data: orphanedAssigned } = await admin
            .from("dealer_attendance")
            .select(`id, dealer_id, check_in_time, dealers!inner(full_name)`)
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
              stuckIssues.push({ id: dealer.id, dealer_name: dealerName, issue: `assigned_orphaned_${stuckMinutes}m` });
              await transitionDealerState(admin, dealer.id, "available", `pass0c_orphaned_assigned_stuck_${stuckMinutes}m`);
              cycleExcludedIds.add(dealer.id);
            }
          }

          // 5. Telegram notification if any stuck issues found
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

          // 6. Force-release stuck assignments + extended OT alerts
          const { data: pass0cEsc } = await admin.rpc("get_escalation_config", { p_club_id: cid }).single();
          const forceReleaseThreshold = pass0cEsc?.force_release_at_overdue_min ?? 30;
          const overdueThreshold = new Date(Date.now() - forceReleaseThreshold * 60_000).toISOString();

          const { data: overdueAssignments } = await admin
            .from("dealer_assignments")
            .select(`id, table_id, swing_due_at, overtime_started_at, game_tables(table_name), dealer_attendance!attendance_id(dealers(full_name))`)
            .eq("club_id", cid)
            .eq("status", "assigned")
            .is("swing_processed_at", null)
            .lt("swing_due_at", overdueThreshold);

          const otThreshold = new Date(Date.now() - 45 * 60_000).toISOString();
          const { data: extendedOtAssignments } = await admin
            .from("dealer_assignments")
            .select(`id, table_id, overtime_started_at, game_tables(table_name), dealer_attendance!attendance_id(dealers(full_name))`)
            .eq("club_id", cid)
            .eq("status", "assigned")
            .is("swing_processed_at", null)
            .not("overtime_started_at", "is", null)
            .lt("overtime_started_at", otThreshold);

          // Force-release logic + Telegram alerts
          let forceReleasedCount = 0;
          const criticalAlerts: string[] = [];

          if (overdueAssignments && overdueAssignments.length > 0) {
            for (const a of overdueAssignments) {
              const overdueMin = Math.floor((Date.now() - new Date(a.swing_due_at).getTime()) / 60_000);
              const tableName = (a.game_tables as any)?.table_name ?? a.table_id;
              const dealerName = (a.dealer_attendance as any)?.dealers?.full_name ?? "Unknown";

              const forceResult = await admin.rpc("force_release_stuck_assignment", {
                p_assignment_id: a.id,
                p_club_id: cid,
                p_reason: `pass0c_force_release_overdue_${Math.min(overdueMin, 240)}min`,
              });

              if (forceResult.error) {
                criticalAlerts.push(`🔴 *Bàn ${tableName}* — Dealer ${dealerName}: QUÁ HẠN ${overdueMin}ph. Force-release FAILED!`);
                continue;
              }

              const fr = forceResult.data as { success: boolean; reason?: string };
              if (!fr?.success) {
                criticalAlerts.push(`🔴 *Bàn ${tableName}* — Dealer ${dealerName}: QUÁ HẠN ${overdueMin}ph. Force-release rejected: ${fr?.reason}`);
                continue;
              }

              forceReleasedCount++;
              criticalAlerts.push(`✅ *Bàn ${tableName}* — Đã force-release (${overdueMin}ph quá hạn).`);
            }
          }

          // Extended OT alert (alert only, no auto-fix)
          if (extendedOtAssignments && extendedOtAssignments.length > 0) {
            for (const a of extendedOtAssignments) {
              const otMin = Math.floor((Date.now() - new Date(a.overtime_started_at).getTime()) / 60_000);
              const tableName = (a.game_tables as any)?.table_name ?? a.table_id;
              const dealerName = (a.dealer_attendance as any)?.dealers?.full_name ?? "Unknown";
              criticalAlerts.push(`⏱ *Bàn ${tableName}* — Dealer ${dealerName}: OT ${otMin}ph (extended). Cần can thiệp!`);
            }
          }

          // Send Telegram summary
          if (criticalAlerts.length > 0) {
            const chatId = await getClubTelegramChatId(admin, cid);
            if (botToken && chatId) {
              const header = forceReleasedCount > 0
                ? `🚨 *Pass 0c — ${forceReleasedCount} force-releases + ${criticalAlerts.length - forceReleasedCount} alerts*\n\n`
                : `🚨 *${criticalAlerts.length} cảnh báo nghiêm trọng*\n\n`;
              const msg = header + criticalAlerts.slice(0, 10).join("\n\n") +
                (criticalAlerts.length > 10 ? `\n\n_...và ${criticalAlerts.length - 10} cảnh báo khác_` : "") +
                `\n\n✅ Đã force-release ${forceReleasedCount} bàn quá hạn.`;
              await sendTelegramNotification(botToken, chatId, msg, { parse_mode: "Markdown" });
            }
          }
        }
```

### Pass 0d — Reconcile dealer states

```typescript
        // ── PASS 0d: Reconcile dealer states ──────────────────────────────────
        {
          const RECONCILE_TIMEOUT_MS = 3000;
          try {
            const response = await Promise.race([
              admin.rpc('reconcile_dealer_states', { p_club_id: cid }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('reconcile_timeout')), RECONCILE_TIMEOUT_MS)
              )
            ]);

            if (response.error) {
              console.error(`[Pass 0d] ❌ DB error:`, response.error.message);
            } else {
              const result = Array.isArray(response.data) ? response.data[0] : response.data;
              const orphan  = result?.fixed_pre_assigned_orphan ?? 0;
              const timeout = result?.fixed_pre_assigned_timeout ?? 0;
              const orphanAssignments = result?.fixed_orphan_assignments ?? 0;
              const total = (result?.fixed_available ?? 0)
                          + (result?.fixed_assigned ?? 0)
                          + orphan + timeout
                          + (result?.cleared_orphaned ?? 0)
                          + orphanAssignments;

              if (orphan > 0) console.error(`[Pass 0d] 🚨 B6 pattern: ${orphan} orphaned pre_assigned`);
              if (total > TOTAL_FIXES_ALERT_THRESHOLD) {
                console.error(`[Pass 0d] 🚨 Excessive fixes (${total})! Possible systemic issue.`);
              }
              if (total > 0) {
                console.warn(`[Pass 0d] ⚠️ Fixed ${total} inconsistencies:`, result);
              } else {
                console.log(`[Pass 0d] ✅ No inconsistencies found`);
              }
            }
          } catch (err: any) {
            const isTimeout = err.message === 'reconcile_timeout';
            console[isTimeout ? 'warn' : 'error'](`[Pass 0d] ${isTimeout ? '⏱️ Timed out' : '❌ Network error'} after ${RECONCILE_TIMEOUT_MS}ms`);
          }
        }
```

### Pass 0e — Auto-end expired meal breaks

```typescript
        // ── PASS 0e — Auto-end expired meal breaks ──────────────────────────────
        try {
          const { data: expiredMealBreaks } = await admin
            .from("dealer_meal_breaks")
            .select("attendance_id, dealer_id, break_start, total_duration_minutes")
            .eq("status", "active")
            .eq("club_id", cid);

          if (expiredMealBreaks && expiredMealBreaks.length > 0) {
            const nowMs = Date.now();
            for (const mb of expiredMealBreaks) {
              const elapsedMin = (nowMs - new Date(mb.break_start).getTime()) / 60_000;
              if (elapsedMin >= mb.total_duration_minutes) {
                const result = await endMealBreak(admin, mb.attendance_id);
                if (result.ok && !result.alreadyEnded) {
                  console.log(`[Pass 0e] Auto-ended meal break for dealer ${mb.dealer_id} (${Math.floor(elapsedMin)}m elapsed, limit ${mb.total_duration_minutes}m)`);
                }
              }
            }
          }
        } catch (pass0eErr) {
          console.error("[Pass 0e] Meal break auto-end error:", pass0eErr instanceof Error ? pass0eErr.message : pass0eErr);
        }
```

### Pass 1 — Fill empty tables

```typescript
        // ── PASS 1 — Auto-fill empty tables ───────────────────────────────
        let fillResult = { assignments: [] as Array<{table_id:string;table_name:string;attendance_id:string;full_name:string}>, assignedAttendanceIds: new Set<string>() };
        if (!dryRun) {
          fillResult = await fillEmptyTables(admin, cid, shiftId, botToken ?? "", cycleExcludedIds, batchSwingDueAt, clubCfg.min_inter_swing_rest_minutes);
          for (const aid of fillResult.assignedAttendanceIds) cycleExcludedIds.add(aid);
          if (fillResult.assignments.length > 0 && botToken && pass2ChatId) {
            const mopMsg = formatMassAssignMessage(
              fillResult.assignments.map(a => ({
                tableName: a.table_name,
                dealer: { full_name: a.full_name },
              }))
            );
            sendTelegramNotification(botToken, pass2ChatId, mopMsg).catch(err => console.error("[process-swing] Telegram error:", err));
          }
        }
```

### Pass 1b — Stale pre-assign cleanup (3-tier circuit breaker)

```typescript
        // ── PASS 1b — Three-tier circuit breaker for stale pre-assign cleanup ──
        // Tier 3 (critical): pre-assign overdue ≥4h → force-release + alert
        // Tier 1+2 (stale):   pre-assign overdue ≥60min + assignment past due → cleanup
        if (clubTableIds.length === 0) {
          console.log(`[Pass 1b] No active tables for club ${cid}`);
        } else {
          const { data: clubInfo } = await admin
            .from("clubs")
            .select("name, last_critical_alert_at")
            .eq("id", cid)
            .single();
          const clubName = clubInfo?.name ?? `Club ${cid.slice(0, 8)}`;

          const overdueThreshold = new Date(Date.now() - SWING_THRESHOLDS.OVERDUE_THRESHOLD_MINUTES * 60 * 1000).toISOString();
          const criticalThreshold = new Date(Date.now() - SWING_THRESHOLDS.CRITICALLY_OVERDUE_HOURS * 60 * 60 * 1000).toISOString();
          const nowISO = new Date().toISOString();

          // ── Tier 3: Critically overdue (4h+) ──
          const { data: criticalRows } = await admin
            .from("dealer_assignments")
            .select("id, pre_assigned_attendance_id, pre_assigned_at, version")
            .eq("status", "assigned")
            .not("pre_assigned_attendance_id", "is", null)
            .lt("pre_assigned_at", criticalThreshold)
            .lt("swing_due_at", nowISO)
            .in("table_id", clubTableIds)
            .limit(SWING_THRESHOLDS.RELEASE_BATCH_SIZE);

          // ... (force-release logic with CAS rollback handling)

          // ── Tier 1+2: Stale pre-assign cleanup (60min+) ──
          const { data: allStaleRaw } = await admin
            .from("dealer_assignments")
            .select("id, pre_assigned_attendance_id, pre_assigned_at, version")
            .eq("status", "assigned")
            .not("pre_assigned_attendance_id", "is", null)
            .lt("pre_assigned_at", overdueThreshold)
            .lt("swing_due_at", nowISO)
            .in("table_id", clubTableIds)
            .limit(SWING_THRESHOLDS.RELEASE_BATCH_SIZE);

          // Classify into truly stale vs still waiting
          // Process safe stale rows with safeguard + circuit breaker
        }
```

### Pass 1c — Orphaned pre-assigned release

```typescript
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
            for (const attId of orphanIds) {
              const result = await transitionDealerState(admin, attId, "available", "pass1c_release_orphan_pre_assign");
              if (result.success) {
                await admin.from("dealer_attendance")
                  .update({ pre_assigned_table_id: null, pre_assigned_at: null })
                  .eq("id", attId);
              }
            }
          }
        }

        // ── SEED: Pre-assigned dealers remaining after cleanup ────────────────
        if (!dryRun) {
          const { data: preAssignedDealers } = await admin
            .from("dealer_attendance")
            .select("id")
            .eq("current_state", "pre_assigned")
            .eq("status", "checked_in")
            .in("dealer_id", cidDealerIds);

          if (preAssignedDealers && preAssignedDealers.length > 0) {
            for (const d of preAssignedDealers) cycleExcludedIds.add(d.id);
            console.log(`[process-swing] Seeded ${preAssignedDealers.length} pre-assigned dealers into cycleExcludedIds`);
          }
        }
```

### Pass 1.5 — Rotation Planner (greedy batch pre-assign)

```typescript
        // ── PASS 1.5 — Rotation Planner ──────────────
        if (!forceAll && !preAssignOnly && clubCfg.rotation_planner_enabled) {
          try {
            const p15Result = await pass15RotationPlanner(admin, cid, {
              dryRun: !!dryRun,
              preAnnounceMinutes: clubCfg.pre_announce_minutes,
              requiredGameTypes: required_game_types,
              cycleExcludedIds,
              clubId: cid,
            });
            console.log(`[Pass 1.5] ${p15Result.assigned} assigned, ${p15Result.unassigned} unassigned`);
          } catch (err: any) {
            console.error(`[Pass 1.5] ❌ Error:`, err.message);
          }
        }
```

### Pass 2 — Pre-assign incoming dealers

```typescript
        // ── PASS 2 — Pre-assign incoming dealers ────────
        if (!forceAll) {
          const pass2Options = {
            clubZone,
            cycleExcludedIds,
            chatId: pass2ChatId,
            botToken,
            minInterSwingRestMinutes: clubCfg.min_inter_swing_rest_minutes,
          };
          if (preAssignOnly) {
            pass2Options.manualWindowMinutes = manualWindowMinutes;
          }
          let pass2Result;
          try {
            pass2Result = await pass2PreAssignNext(admin, cid, clubCfg.pre_announce_minutes, pass2Options);
          } catch (err) {
            pass2Result = { pre_assigned_count: 0 };
          }
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
```

### Pass 2.5 — Initial assign (assignments without dealer_id)

```typescript
        // ── PASS 2.5 — Assign initial dealers ──────────
        {
          const pass25Result = await pass25InitialAssign(admin, cid, cycleExcludedIds, required_game_types, clubCfg.min_inter_swing_rest_minutes);
          if (pass25Result.assigned_count > 0) {
            console.log(`[Pass 2.5] ✅ Assigned ${pass25Result.assigned_count} initial dealers`);
          }
        }
```

### Dynamic swing duration

```typescript
        // ── Dynamic swing duration ──────────────────────
        const swingDurResult = await computeSwingDuration(admin, cid, {
          swing_duration_minutes: clubCfg.swing_duration_minutes,
          auto_adjust_duration: clubCfg.auto_adjust_duration,
          min_duration: clubCfg.min_duration,
          max_duration: clubCfg.max_duration_minutes,
          sync_swings: clubCfg.sync_swings,
          sync_window_minutes: clubCfg.sync_window_minutes,
        });
        console.log(`[process-swing] Club ${cid} swing duration:`, swingDurResult.durationRationale);
```

### Pass 3 — Execute swings

```typescript
        // ── PASS 3 — Execute swings at T-0 ──────────────
        const nowPlusBuf = new Date(Date.now() + SWING_WINDOW_BUFFER_MINUTES * 60 * 1000).toISOString();
        const now = new Date().toISOString();

        // Three queries: pre_assigned due, normal due, zombie locks
        const [{ data: preAssignedDueAssignments }, { data: normalDueAssignments }, { data: zombieDueAssignments }] = await Promise.all([
          buildDueQuery()
            .eq("swing_in_progress", false)
            .not("pre_assigned_attendance_id", "is", null)
            .limit(100),
          buildDueQuery()
            .eq("swing_in_progress", false)
            .is("pre_assigned_attendance_id", null)
            .limit(100),
          buildDueQuery()
            .eq("swing_in_progress", true)
            .lt("updated_at", zombieCutoff)
            .limit(100),
        ]);

        const dueAssignments = sortPass3Candidates([
          ...(preAssignedDueAssignments ?? []),
          ...(normalDueAssignments ?? []),
          ...(zombieDueAssignments ?? []),
        ]).slice(0, 8);

        // For each assignment:
        //   - Optimistic lock (CAS on swing_in_progress)
        //   - Pre-assigned path: execute_pre_assigned_swing RPC
        //     - success → post-swing pre-assign
        //     - race_lost → no-show detection → emergency re-assign or OT
        //   - Non-pre-assigned path:
        //     - Graduated escalation (Tier 0/1/2/3)
        //     - Emergency pre-assign (Hướng 2)
        //     - OT fallback
        //   - Force-release (if overdue > threshold)
        //   - Finally: reset swing_in_progress
```

### Pass 4 — End expired breaks & Pass 4b — Refresh pool

```typescript
        // ── PASS 4 — End expired breaks ──────────────────
        if (!dryRun) {
          const { data: endedBreaks } = await admin.rpc("end_expired_breaks", { p_club_id: cid });
          if (endedBreaks && endedBreaks.length > 0) {
            console.log(`[process-swing] Pass 4: ended ${endedBreaks.length} expired breaks`);
          }
        }

        // ── PASS 4b — Refresh dealer pool summary ────────
        if (!dryRun) {
          try {
            const { error: refreshErr } = await admin.rpc("refresh_dealer_pool_summary");
            if (refreshErr) console.warn("[Pass 4b] ⚠️ Pool summary refresh failed:", refreshErr.message);
          } catch (err: any) {
            console.warn("[Pass 4b] ⚠️ Pool summary refresh exception:", err.message);
          }
        }
```

### Shortage escalation & all-tables-OT alert

```typescript
        // ── SHORTAGE ESCALATION ──────────────────────────
        if (!dryRun && metrics.total > 0 && metrics.failed === 0) {
          const noDealerRatio = metrics.no_dealer / metrics.total;
          if (noDealerRatio > 0.5 && metrics.no_dealer >= 3) {
            // Fetch shortage config, auto-close low priority tables if enabled
            // Send Telegram notification
          }
        }

        // ── All-tables-OT alert ──────────────────────────
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
          // Send Telegram: TOÀN BỘ BÀN ĐANG OT
        }

        // Flush TelegramNotifier
        notifier?.flush().catch((err) =>
          console.warn("[process-swing] notifier flush error:", err.message)
        );

        // Write metrics
        const localDate = await getClubLocalDate(admin, cid);
        if (metrics.total > 0 || metrics.skipped > 0) {
          await admin.from("swing_metrics").upsert({ ... }, { onConflict: "club_id,date" });
        }
```

### Lock release & execution summary

```typescript
        clubsProcessed++;
      } catch (err) {
        clubsSkippedError++;
        console.error(`[process-swing] ❌ Unhandled error for club ${cid}:`, err);
      } finally {
        if (lockAcquired) {
          try {
            await admin.rpc("release_club_lock", { p_club_id: cid });
          } catch (releaseErr) {
            console.error(`[process-swing] ❌ Lock release failed for ${cid}:`, releaseErr);
          }
        }
      }
    } // END club processing loop

    const totalExecutionMs = Date.now() - executionStartTime;

    console.log("[process-swing] Execution summary", JSON.stringify({
      total_clubs: clubIds.length,
      processed: clubsProcessed,
      skipped_locked: clubsSkippedLocked,
      skipped_error: clubsSkippedError,
      execution_time_ms: totalExecutionMs,
    }));

    return new Response(JSON.stringify({ ok: true, execution_time_ms: totalExecutionMs, metrics: metricsPerClub }));
  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
});

function formatSwingSkippedAlert(tableName: string, retryCount: number): string {
  return `🚨 *Bàn ${tableName}* — Không có dealer thay sau ${retryCount} lần thử. Cần can thiệp thủ công!`;
}
```

---

## 2. pickNextDealer.ts — Dealer Selection với Guards

File: `supabase/functions/_shared/pickNextDealer.ts` (896 dòng)

### Types

```typescript
export interface PickDealerOptions {
  tourTier?: "HIGH" | "MEDIUM" | "LOW";
  swingDurationMinutes?: number;
  requiredGameTypes?: string[];
  currentTableId?: string;
  excludeAttendanceIds?: Set<string>;
  returnTopN?: number;
  includeScoreBreakdown?: boolean;
  clubAvgBreakRatio?: number;
  skipPriorityBreakGuard?: boolean;
  skipFatigueHardCap?: boolean;
  clubBreakDurationMinutes?: number;
  minRestMinutes?: number;
  minInterSwingRestMinutes?: number;  // Default: 10
  swingDueAt?: string;                // Predictive pre-assignment
}

export interface DealerCandidate {
  id: string;
  dealer_id: string;
  full_name: string;
  telegram_username?: string;
  telegram_user_id?: string;
  tier: "A" | "B" | "C";
  skills: string[];
  worked_minutes_since_last_break: number;
  last_table_id?: string;
  consecutive_assignments: number;
  rest_minutes: number;
  priority_break_flag: boolean;
  current_state: "available" | "on_break";
  last_tour_tier: string;
  score?: number;
  score_breakdown?: ScoreBreakdown;
}

export interface ScoreBreakdown {
  rest_bonus: number;
  tier_bonus: number;
  back_to_back_penalty: number;
  consecutive_penalty: number;
  mixed_bonus: number;
  skill_bonus: number;
  priority_break_penalty: number;
  heavy_worker_penalty: number;
  consecutive_high_penalty: number;
  tier_back_to_back_penalty: number;
  break_equity_penalty: number;
  priority_swing_bonus: number;
  fatigue_penalty: number;
}
```

### buildDealerCandidates — Core logic

```typescript
export async function buildDealerCandidates(
  admin: SupabaseAdmin,
  clubId: string,
  options: PickDealerOptions = {}
): Promise<BuildCandidatesResult> {
  const {
    tourTier,
    requiredGameTypes,
    currentTableId,
    excludeAttendanceIds = new Set(),
    includeScoreBreakdown,
    clubAvgBreakRatio,
    skipPriorityBreakGuard = false,
    skipFatigueHardCap = false,
    clubBreakDurationMinutes = 20,
    minRestMinutes = 10,
    minInterSwingRestMinutes: rawMinInterSwingRestMinutes = 10,
    swingDueAt,
  } = options;
  const minInterSwingRestMinutes = Math.max(0, rawMinInterSwingRestMinutes ?? 10);

  // Step 1: Get active dealer IDs for this club
  const { data: clubDealers } = await admin
    .from("dealers")
    .select("id")
    .eq("club_id", clubId)
    .eq("status", "active");
  const dealerIds = (clubDealers ?? []).map((d: { id: string }) => d.id);
  if (dealerIds.length === 0) return { candidates: [], avgBreakRatio: null };

  // Step 1b: Check if requesting table has priority_swing_at
  let isPrioritySwing = false;
  if (currentTableId) {
    const { data: currentAssignment } = await admin
      .from("dealer_assignments")
      .select("priority_swing_at")
      .eq("table_id", currentTableId)
      .eq("status", "assigned")
      .is("swing_processed_at", null)
      .maybeSingle();
    isPrioritySwing = !!(currentAssignment as any)?.priority_swing_at;
  }

  // Step 2: Query dealer_attendance — available and on_break dealers
  const minBreakMinutes = options.clubBreakDurationMinutes ?? 15;

  const { data: rawRows, error } = await admin
    .from("dealer_attendance")
    .select(`id, dealer_id, current_state, status, worked_minutes_since_last_break, priority_break_flag, check_in_time, last_released_at, dealers!inner(full_name, telegram_username, telegram_user_id, tier, skills)`)
    .eq("status", "checked_in")
    .in("dealer_id", dealerIds)
    .or(`current_state.eq.available,current_state.eq.on_break`);

  // Step 3: Query dealer_shift_metrics
  // Step 4: Query last 2 assignments for back-to-back detection
  // Step 5: Exclude busy dealers (24h rolling window)
  const busyDealerIds = new Set<string>();
  const busyWindow = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: busyDealers } = await admin
    .from("dealer_attendance")
    .select("dealer_id")
    .in("dealer_id", dealerIds)
    .in("current_state", ["assigned", "pre_assigned", "in_transition"])
    .is("check_out_time", null)
    .gte("check_in_time", busyWindow);
  for (const bd of busyDealers ?? []) busyDealerIds.add(bd.dealer_id);
```

#### Break pool guard (HARD guard — always enforces minimum 10 minutes)

```typescript
  // ── Break pool guard (independent check, runs BEFORE OR logic) ──
  // Hard wall-clock check using NOW(): excludes dealers still within the
  // inter-swing rest period. This is a HARD requirement that cannot be
  // bypassed by the OR logic (passedMinutesSinceRest via swingDueAt) NOR
  // by escalation tiers — always enforces minimum 10 minutes of rest.
  const restGuardExcludedIds = new Set<string>();
  const guardMinutes = Math.max(minInterSwingRestMinutes, 10);
  if (guardMinutes > 0) {
    const restCutoff = new Date(Date.now() - guardMinutes * 60_000).toISOString();
    const { data: restingDealers } = await admin
      .from("dealer_attendance")
      .select("id")
      .in("id", attendanceIds)
      .not("last_released_at", "is", null)
      .gt("last_released_at", restCutoff);
    for (const rd of restingDealers ?? []) restGuardExcludedIds.add(rd.id);
    if (restingDealers && restingDealers.length > 0) {
      console.log(`[pickNextDealer] Break pool guard: ${restingDealers.length} dealers excluded (rest not completed)`);
    }
  }
```

#### Pool cooldown guard (1 phút cho Telegram)

```typescript
  // ── Pool cooldown guard (1 phút cho Telegram kịp gửi pre-assign) ──
  // Dealer vừa vào pool (vừa release hoặc break vừa kết thúc) cần tối
  // thiểu 1 phút để Telegram kịp gửi thông báo pre-assigned trước khi
  // bị pick lại. pool_entered_at được set = NOW() khi:
  //   - perform_swing release dealer
  //   - execute_pre_assigned_swing release dealer
  //   - end_expired_breaks kết thúc break
  // NULL → dealer chưa từng release (new hire) → skip.
  const poolCooldownMinutes = 1;
  if (poolCooldownMinutes > 0) {
    try {
      const poolCutoff = new Date(Date.now() - poolCooldownMinutes * 60_000).toISOString();
      const { data: poolDealers, error: poolErr } = await admin
        .from("dealer_attendance")
        .select("id")
        .in("id", attendanceIds)
        .in("current_state", ["available", "on_break"])
        .not("pool_entered_at", "is", null)
        .gt("pool_entered_at", poolCutoff);
      if (poolErr) {
        console.error(`[pickNextDealer] Pool cooldown query error: ${poolErr.message}`);
      } else if (poolDealers && poolDealers.length > 0) {
        for (const pd of poolDealers) restGuardExcludedIds.add(pd.id);
        console.log(`[pickNextDealer] Pool cooldown guard: ${poolDealers.length} dealers excluded`);
      }
    } catch (poolCatchErr) {
      console.error(`[pickNextDealer] Pool cooldown exception:`, poolCatchErr);
    }
  }
```

### Full exclusion + scoring loop

```typescript
  // Build diagnostics
  const diag = {
    total_rows: rows.length, duplicate_dealer_rows, busy_excluded: 0,
    exclude_set_excluded: 0, tier_excluded: 0, fatigue_excluded: 0,
    priority_break_excluded: 0, break_pool_guard_excluded: 0,
    min_rest_excluded: 0, on_break_excluded: 0,
    inter_swing_cooldown_excluded: 0, game_type_excluded: 0,
    meal_break_excluded: 0, candidates_count: 0,
  };

  // Step 5b: Cross-check dealer_assignments for busy dealers (B6 defense)
  // Step 5c: Safety net — pre_assigned dealers without assignment record

  // Step 6: Fetch club average break ratio

  // Meal break exclusion (defense-in-depth)

  const candidates: DealerCandidate[] = [];
  for (const row of rows) {
    // Intra-cycle exclusion
    if (busyDealerIds.has(row.dealer_id)) { diag.busy_excluded++; continue; }
    if (excludeAttendanceIds.has(row.id)) { diag.exclude_set_excluded++; continue; }
    if (mealBreakExcludedIds.has(row.id)) { diag.meal_break_excluded++; continue; }

    // Break pool guard — hard exclude (restGuardExcludedIds from pool cooldown + break pool)
    if (restGuardExcludedIds.has(row.id)) { diag.break_pool_guard_excluded++; continue; }

    // Emergency pre-assign guard
    if (row.current_state === "pre_assigned") { diag.busy_excluded++; continue; }

    // On-break minimum rest guard
    // High-stakes tier guard (HIGH tables exclude C tier)
    // Fatigue hard cap (consecutive >= 4 && restMin < 10)
    // Priority break + rest guard
    // Rest cooldown (OR logic: shift rest OR inter-swing release gap)
    // Soft cap warning (log only)
    // Game type hard-exclude

    // ── Scoring ──
    let score = 0;
    // On-break penalty: -50
    // Rest bonus: 200/100/50
    // Tier bonus: matches table's tier
    // Consecutive penalty
    // Skill bonus: +20 per matching game type
    // Priority break penalty: -500
    // Heavy worker penalty
    // Consecutive HIGH penalty
    // Tier-aware back-to-back penalty
    // Break equity penalty (below-average break ratio)
    // Priority swing bonus: +300
    // Fatigue penalty (Level 3 emergency): -300
  }

  candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { candidates, avgBreakRatio };
}

// ── pickNextDelever — returns top candidate ──
export async function pickNextDealer(admin, clubId, options = {}): Promise<DealerCandidate | null> {
  const { candidates } = await buildDealerCandidates(admin, clubId, options);
  return candidates[0] ?? null;
}
```

### Score breakdown label

```typescript
export function buildScoreLabel(tier: string, scoreBreakdown: ScoreBreakdown): string {
  const parts: string[] = [];
  if (tier === "A") parts.push("Dealer hạng A ưu tiên");
  else if (tier === "B") parts.push("Hạng B – phù hợp");
  if (scoreBreakdown.rest_bonus >= 200) parts.push("Thời gian nghỉ dài");
  else if (scoreBreakdown.rest_bonus >= 100) parts.push("Nghỉ ngơi đủ");
  if (scoreBreakdown.skill_bonus > 0) parts.push("Có kỹ năng phù hợp");
  if (scoreBreakdown.tier_back_to_back_penalty < 0) parts.push("Tránh bàn cũ");
  if (scoreBreakdown.heavy_worker_penalty < 0) parts.push("Đã làm nhiều swing");
  if (scoreBreakdown.consecutive_high_penalty < 0) parts.push("Nghỉ bàn HIGH");
  if (scoreBreakdown.priority_break_penalty < 0) parts.push("Đến giờ nghỉ");
  if (scoreBreakdown.break_equity_penalty < 0) parts.push("Cần cân bằng nghỉ");
  if (scoreBreakdown.priority_swing_bonus > 0) parts.push("Bàn ưu tiên");
  if (scoreBreakdown.fatigue_penalty < 0) parts.push("Khẩn cấp – mệt nhiều");
  return parts.length ? parts.join(" · ") : "Sẵn sàng";
}
```

---

## 3. pass2-pre-assign.ts — Pre-assign Pass

File: `supabase/functions/process-swing/passes/pass2-pre-assign.ts` (419 dòng)

```typescript
import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickNextDealer } from "../../_shared/dealer-utils.ts";
import { sendPreAssignTelegramWithFallback } from "../../_shared/preAssignTelegram.ts";

export async function pass2PreAssignNext(
  admin: SupabaseClient,
  clubId: string,
  preAnnounceMinutes: number,
  options: {
    clubZone: string | null;
    chatId: string | null;
    botToken?: string | null;
    cycleExcludedIds: Set<string>;
    manualWindowMinutes?: number;
    minInterSwingRestMinutes?: number;
  },
): Promise<{ pre_assigned_count: number; skipped_count: number; errors: Array<{ table_id: string; error: string }> }> {
```

### Step 1: Find assignments needing pre-assignment

```typescript
  // Two windows:
  //   Normal tables:  [now + (preAnnounce-5), now + (preAnnounce+5)]
  //   OT emergency:   [now + (EMERGENCY_OT-2), now + (EMERGENCY_OT+2)]
  //   Manual:         [now, now + manualWindowMinutes]
  const EMERGENCY_OT_PRE_ANNOUNCE_MINUTES = 3;

  const normalWindowStart = new Date(
    Date.now() + (manualWindowMinutes ? 0 : (preAnnounceMinutes - 5) * 60_000)
  ).toISOString();
  const normalWindowEnd = new Date(
    Date.now() + (manualWindowMinutes ?? (preAnnounceMinutes + 5)) * 60_000
  ).toISOString();

  // Query assignments needing pre-assignment (swing_due_at within window, no pre_assigned_attendance_id yet)
  // Separate queries for normal and OT emergency, then merge + deduplicate
```

### Step 2: Pre-assign one dealer per table

```typescript
  for (const assignment of upcomingAssignments) {
    const tableName = (assignment.game_tables as any)?.table_name ?? "??";

    const nextDealer = await pickNextDealer(admin, clubId, {
      currentTableId: assignment.table_id,
      excludeAttendanceIds: cycleExcludedIds,
      minInterSwingRestMinutes: options.minInterSwingRestMinutes ?? 10,
      swingDueAt: assignment.swing_due_at,  // Predictive: allow dealers who will complete rest before swing
    });

    if (!nextDealer) { result.skipped_count++; continue; }

    // Call CAS-based RPC for atomic pre-assignment
    const { data: rpcResult, error: rpcErr } = await admin.rpc("pre_assign_next_dealer_for_table", {
      p_assignment_id: assignment.id,
      p_club_id: clubId,
      p_next_attendance_id: nextDealer.id,
      p_version: assignment.version,
    });

    // Handle outcomes: pre_assigned, race_lost, dealer_unavailable, error
    // On success: send Telegram pre-announce via sendPreAssignTelegramWithFallback
    //   (direct send with queue fallback via pre_announce_jobs table)
  }
```

---

## 4. pass2.5-initial-assign.ts — Initial Assign

File: `supabase/functions/process-swing/passes/pass2.5-initial-assign.ts` (217 dòng)

```typescript
export async function pass25InitialAssign(
  admin: SupabaseClient,
  clubId: string,
  cycleExcludedIds: Set<string>,
  requiredGameTypes?: string[],
  minInterSwingRestMinutes?: number,
): Promise<{ assigned_count: number; skipped_count: number; errors: Array<...> }> {
  // Step 1: Find assignments with dealer_id IS NULL but attendance_id set
  // Step 2: Fill dealer_id for each empty assignment
  //   Case A: attendance_id already points to a valid dealer → fill_dealer_id RPC
  //   Case B: attendance has no valid dealer → pickNextDealer with progressive fallback
}
```

---

## 5. pass1.5-rotation-planner.ts — Rotation Planner (Greedy Batch Pre-assign)

File: `supabase/functions/process-swing/passes/pass1.5-rotation-planner.ts` (281 dòng)

```typescript
export async function pass15RotationPlanner(
  admin: SupabaseClient,
  clubId: string,
  options: Pass15Options
): Promise<Pass15Result> {
  // Step 1: Query tables in upcoming rotation window (swing_due_at in [T+1min, T+(preAnnounce-2)min])
  // Step 2: Filter to tables not already pre-assigned
  // Step 3: Build rotation candidates via buildDealerCandidates
  // Step 4: Solve greedy (solveGreedyLazy)
  // Step 5: dryRun path — verify DB but skip writes
  // Step 6: Write path — verify + sequential RPC calls with timeout
}
```

---

## 6. pass3-post-swing-assign.ts — Post-Swing Pre-assign

File: `supabase/functions/process-swing/passes/pass3-post-swing-assign.ts` (128 dòng)

```typescript
export async function postSwingPreAssign(
  admin: SupabaseClient,
  clubId: string,
  newAssignmentId: string,
  tableId: string,
  options: { chatId: string | null; botToken?: string | null; minInterSwingRestMinutes?: number },
): Promise<{ assigned: boolean; dealerName?: string; reason?: string }> {
  // Called immediately after a successful swing to pre-assign the NEXT dealer
  // 1. Fetch assignment
  // 2. pickNextDealer (immediate — no window)
  // 3. pre_assign_next_dealer_for_table RPC
  // 4. Send Telegram notification
}
```

---

## 7. process-pre-announce-jobs/index.ts — Telegram Queue Processor

File: `supabase/functions/process-pre-announce-jobs/index.ts` (430 dòng)

```typescript
const MAX_JOBS_PER_TICK = 20;
const PER_JOB_TIMEOUT_MS = 5000;
const TICK_TIMEOUT_MS = 25000;
const CIRCUIT_BREAKER_FAILURES = 10;
const CIRCUIT_BREAKER_WINDOW_MIN = 5;
const MAX_HTTP_RETRIES = 3;

Deno.serve(async (req) => {
  // Auth: Bearer token in Authorization header
  // Step 1: Circuit breaker — check recent failures (10 failures in 5 min → skip tick)
  // Step 2: Cancel expired jobs (expires_at < now)
  // Step 3: Pick pending jobs (up to MAX_JOBS_PER_TICK)
  // Step 4: Claim all jobs atomically, group by chat_id+zone, batch-send per group
  //   - 5s per-attempt timeout (AbortController)
  //   - 3 HTTP-level retries with exponential backoff (200ms, 400ms)
  //   - DB-level max_attempts
  // Step 5: Log metric to cron_metrics
  // Tick timeout: 25s hard cap to prevent overlap with 30s cron
});
```

### sendTelegramWithTimeout helper

```typescript
async function sendTelegramWithTimeout(
  botToken: string,
  chatId: string,
  text: string,
  timeoutMs: number,
): Promise<SendResult> {
  for (let attempt = 1; attempt <= MAX_HTTP_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: String(chatId),
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      if (res.ok) return { ok: true };

      const errText = await res.text();
      // 4xx = client error, not transient
      if (res.status >= 400 && res.status < 500) return { ok: false, error: errText.substring(0, 200) };

      if (attempt === MAX_HTTP_RETRIES) return { ok: false, error: errText.substring(0, 200) };
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt - 1)));
    } catch (err) {
      if (attempt === MAX_HTTP_RETRIES) return { ok: false, error: `timeout/exception: ${err}` };
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt - 1)));
    }
  }
  return { ok: false, error: "exhausted_retries" };
}
```

---

## 8. Database Migration: Add pool_entered_at

File: `supabase/migrations/20260804000000_add_pool_entered_at.sql` (364 dòng)

```sql
-- Migration: add_pool_entered_at
-- Pool cooldown guard: dealer vừa vào pool cần 1 phút buffer để
-- Telegram kịp gửi pre-assign notification trước khi bị pick lại.

-- 1. Add pool_entered_at to dealer_attendance
ALTER TABLE public.dealer_attendance
  ADD COLUMN IF NOT EXISTS pool_entered_at TIMESTAMPTZ;

-- 2. Partial index cho pool cooldown query
CREATE INDEX IF NOT EXISTS idx_dealer_attendance_pool_entered
  ON public.dealer_attendance(club_id, pool_entered_at)
  WHERE current_state IN ('available', 'on_break');

-- 3. Backfill: pool_entered_at = last_released_at cho record cũ
UPDATE dealer_attendance
SET pool_entered_at = last_released_at
WHERE last_released_at IS NOT NULL
  AND pool_entered_at IS NULL;

-- 4. Update perform_swing RPC: set pool_entered_at = v_now
CREATE OR REPLACE FUNCTION public.perform_swing(...)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- ...
  UPDATE dealer_attendance
  SET current_state = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
    worked_minutes_since_last_break = 0,
    overtime_minutes = COALESCE(overtime_minutes, 0) + v_ot_minutes,
    priority_break_flag = false,
    total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min,
    last_released_at = v_now,
    pool_entered_at = v_now,    -- <-- NEW
    updated_at = v_now
  WHERE id = v_old_attendance_id;
  -- ...
END;
$$;

-- 5. Update execute_pre_assigned_swing RPC: set pool_entered_at = v_now
CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing(...)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- ...
  UPDATE dealer_attendance
  SET current_state = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
    worked_minutes_since_last_break = 0,
    overtime_minutes = COALESCE(overtime_minutes, 0) + v_ot_minutes,
    priority_break_flag = false,
    total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min,
    last_released_at = v_now,
    pool_entered_at = v_now,    -- <-- NEW
    updated_at = v_now
  WHERE id = v_old_attendance_id;
  -- ...
END;
$$;

-- 6. Update end_expired_breaks: set pool_entered_at = NOW() (không NULL)
CREATE OR REPLACE FUNCTION public.end_expired_breaks(p_club_id UUID DEFAULT NULL)
RETURNS TABLE(attendance_id UUID, dealer_name TEXT, break_start TIMESTAMPTZ, expected_duration_minutes INT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH expired AS (...)
  UPDATE dealer_attendance da
  SET
    current_state = 'available',
    priority_break_flag = false,
    worked_minutes_since_last_break = 0,
    last_released_at = NULL,
    pool_entered_at = NOW(),    -- <-- NEW (instead of NULL)
    updated_at = NOW()
  FROM expired
  WHERE da.id = expired.att_id
  RETURNING da.id, expired.d_name, expired.br_start, expired.exp_min;
END;
$$;
```

---

## Flow Diagram

```
pg_cron (30s)
  │
  ├── process-pre-announce-jobs (process pre_announce_jobs queue)
  │     └── Telegram API (sendMessage)
  │
  └── process-swing
        │
        ├── [Lock] try_acquire_club_lock (per club)
        │
        ├── Pass 0:  Pool snapshot → batch swing duration
        ├── Pass 0b: Count available dealers
        ├── Pass 0c: Stuck detection & auto-fix
        │     ├── Pre_assigned incomplete → available
        │     ├── Orphaned pre_assigned → available
        │     ├── Overdue breaks → auto-end
        │     ├── Stuck in_transition → available
        │     ├── Orphaned assigned → available
        │     └── Force-release stuck assignments (>30min overdue)
        ├── Pass 0d: Reconcile dealer states
        ├── Pass 0e: Auto-end expired meal breaks
        ├── Pass 1:  Fill empty tables
        │     └── Telegram: Mở Bàn (N bàn)
        ├── Pass 1b: Stale pre-assign cleanup
        │     ├── Tier 3: Critical (4h+) → force-release + alert
        │     └── Tier 1+2: Stale (60m+) → cleanup + circuit breaker
        ├── Pass 1c: Orphaned pre_assigned release
        ├── Pass 1.5: Rotation planner (greedy batch, feature-flagged)
        ├── Pass 2:  Pre-assign (window-based)
        │     ├── pickNextDealer (with guards)
        │     ├── pre_assign_next_dealer_for_table RPC
        │     └── Telegram: pre-assign notification (+ queue fallback)
        ├── Pass 2.5: Initial assign (dealer_id=NULL)
        ├── Pass 3:  Execute swings
        │     ├── Lock: optimistic CAS on swing_in_progress
        │     ├── Pre-assigned path → execute_pre_assigned_swing RPC
        │     │     ├── success → post-swing pre-assign
        │     │     ├── race_lost → no-show detection
        │     │     │     ├── Emergency re-assign (with delay)
        │     │     │     └── OT fallback
        │     │     └── error → replacement fallback
        │     ├── Non-pre-assigned path
        │     │     ├── Tier 0: Normal pick
        │     │     ├── Tier 1: 5+ min overdue
        │     │     ├── Tier 2: 15+ min overdue
        │     │     ├── Tier 3: 30+ min overdue (emergency)
        │     │     ├── Emergency pre-assign (Hướng 2)
        │     │     └── OT fallback
        │     ├── Force-release (>30min overdue → force_release RPC)
        │     └── Finally: reset swing_in_progress
        ├── Pass 4:  End expired breaks
        ├── Pass 4b: Refresh dealer pool summary
        ├── Shortage escalation (auto-close + Telegram)
        └── All-tables-OT alert

Guards in pickNextDealer:
  1. Busy dealer exclusion (24h window)
  2. Break pool guard (HARD: min 10 min, NOW()-based)
  3. Pool cooldown guard (HARD: 1 min for Telegram)
  4. B6 cross-check (Step 5b)
  5. Pre-assigned safety net (Step 5c)
  6. Meal break exclusion
  7. On-break minimum rest
  8. High-stakes tier guard
  9. Fatigue hard cap
  10. Priority break guard
  11. Rest cooldown (OR logic)
  12. Game type hard-exclude
```

---

## Key Design Decisions

1. **Break pool guard HARD**: `Math.max(minInterSwingRestMinutes, 10)` — always at least 10 min, NOT bypassable by escalation tiers
2. **Pool cooldown guard**: 1 phút hard buffer, shares `restGuardExcludedIds` with break pool guard
3. **Both guards run BEFORE OR logic and escalation tiers** — guaranteed minimum rest
4. **pool_entered_at** set to `NOW()` on break end (not NULL) so pool cooldown applies after breaks
5. **New hires** (`pool_entered_at = NULL`) skip pool cooldown guard
6. **Pass 3 graduated escalation** is config-driven via `swing_escalation_config`, NOT hardcoded
7. **Club-level lock** prevents concurrent cron ticks from processing the same club
8. **Optimistic CAS** on version column prevents duplicate swing execution
9. **Telegram notifications** use direct send + `pre_announce_jobs` queue as fallback
10. **`end_expired_breaks`** sets `pool_entered_at = NOW()` but clears `last_released_at = NULL`
