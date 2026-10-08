// ═══════════════════════════════════════════════════════════════════════════
// Step 2 — predictive pre-assign of a soon-free (on_break) dealer to an EMPTY
// active table, then execute when the dealer's break ends.
//
// Self-contained pass so the footprint in the process-swing monolith stays tiny
// (process-swing just calls runEmptyTablePreAssign() once per club, behind the
// per-club AUTO_PREASSIGN_EMPTY_TABLES_CLUB_IDS env flag, default OFF).
//
// All reservation mutations go through the SECURITY DEFINER RPCs from migration
// 20270128000023 — never a raw UPDATE of reservation rows:
//   reserve_empty_table_for_dealer_v2 / execute_empty_table_reservation_v2 /
//   cancel_empty_table_reservation
//
// Invariants: never opens a new table; never pulls a dealer off break early
// (execute waits for current_state='available' + the 15-min rest gate); the
// reserved dealer stays on_break until they naturally free up.
// ═══════════════════════════════════════════════════════════════════════════

import { buildRotationSupply } from "../../_shared/pickNextDealer.ts";
import { sendTelegramNotification, mention } from "../../_shared/telegram.ts";
import { getDealerOperationalTables } from "../../_shared/dealerOperationalTables.ts";

export type SupabaseAdmin = any;

// Mirror process-swing's execute-time hard rest floor (owner policy 2026-06-13,
// raised to 15 on 2026-07-05 — keep in sync with process-swing/index.ts).
const EXECUTE_MIN_REST_MINUTES = 15;
// A reservation whose dealer never frees up self-cancels after this age so it
// can't block the table forever.
const RESERVATION_STALE_MINUTES = 30;

interface RunOpts {
  botToken?: string;
  chatId?: string | null;
  /** Inter-swing rest minutes (club config). Passed to buildRotationSupply. */
  minInterSwingRestMinutes?: number;
  /** Swing duration minutes (club config) — sets the new table's swing clock. */
  swingDurationMinutes?: number;
}

export interface EmptyTablePreAssignResult {
  executed: number;
  reserved: number;
  cancelled: number;
  /** A failed candidate snapshot is not a normal no-candidate reservation result. */
  candidateStatus?: "dependency_unavailable" | "query_failed";
  candidateErrorCode?: string;
}

export async function runEmptyTablePreAssign(
  admin: SupabaseAdmin,
  clubId: string,
  opts: RunOpts = {},
): Promise<EmptyTablePreAssignResult> {
  const botToken = opts.botToken;
  const chatId = opts.chatId ?? null;
  const restMin = opts.minInterSwingRestMinutes ?? 10;
  const durMin = opts.swingDurationMinutes ?? 45;
  const res: EmptyTablePreAssignResult = { executed: 0, reserved: 0, cancelled: 0 };
  const slog = (event: string, data: Record<string, unknown>) =>
    console.log(`[passS2] ${event} ${JSON.stringify({ club_id: clubId, ...data })}`);

  const tg = (text: string) => {
    if (botToken && chatId) {
      sendTelegramNotification(botToken, chatId, text).catch((err) =>
        console.error("[passS2] Telegram error:", err));
    }
  };

  // ── 1. EXECUTE / CANCEL existing reservations ──────────────────────────────
  const tables = await getDealerOperationalTables(admin, clubId);
  const sessions = new Map(tables.map(t => [t.id, t.table_session_id]));
  const cancel = async (id: string, reason: string) => {
    const { data, error } = await admin.rpc("cancel_empty_table_reservation", { p_reservation_id: id, p_reason: reason });
    if (error) throw error;
    if (data?.ok !== true || !["ok", "not_reserved"].includes(data?.outcome)) throw new Error("reservation_cancel_unverified");
    if (data.outcome === "ok") res.cancelled++;
  };
  const { data: reservations, error: reservationError } = await admin
    .from("dealer_assignments")
    .select("id, table_id, table_session_id, attendance_id, pre_assigned_at, game_tables(table_name), dealers(full_name, telegram_username)")
    .eq("club_id", clubId)
    .eq("status", "reserved")
    .is("released_at", null);
  if (reservationError) throw reservationError;
  if (!Array.isArray(reservations)) throw new Error("reservation_snapshot_unverified");

  for (const r of reservations ?? []) {
    // Never bind a legacy/null or replaced incarnation to the newly opened table.
    if (!r.table_session_id || sessions.get(r.table_id) !== r.table_session_id) {
      await cancel(r.id, "table_session_changed");
      continue;
    }
    const tableName = (r as any).game_tables?.table_name ?? r.table_id;
    const dealer = (r as any).dealers ?? { full_name: "Dealer" };
    const ment = mention({ full_name: dealer.full_name, telegram_username: dealer.telegram_username ?? null });

    const { data: att, error: attendanceError } = await admin
      .from("dealer_attendance")
      .select("current_state, status, last_released_at")
      .eq("id", r.attendance_id)
      .maybeSingle();
    if (attendanceError) throw attendanceError;

    // Dealer gone / checked out → cancel the reservation.
    if (!att || att.status !== "checked_in" || att.current_state === "checked_out") {
      await cancel(r.id, "dealer_gone");
      slog("reservation_cancelled", { reservation_id: r.id, reason: "dealer_gone" });
      continue;
    }

    // Still resting → wait, unless the reservation has gone stale.
    if (att.current_state === "on_break") {
      const ageMin = r.pre_assigned_at
        ? (Date.now() - new Date(r.pre_assigned_at).getTime()) / 60000 : 0;
      if (ageMin > RESERVATION_STALE_MINUTES) {
        await cancel(r.id, "stale_never_freed");
        slog("reservation_cancelled", { reservation_id: r.id, reason: "stale", age_min: Math.round(ageMin) });
      }
      continue;
    }

    // Committed elsewhere somehow (assigned/pre_assigned/in_transition) → skip;
    // the execute RPC would no-op, and the dealer is busy on a real table.
    if (att.current_state !== "available") continue;

    // available → enforce the 15-min execute rest gate (also checked by server).
    const restElapsed = att.last_released_at
      ? (Date.now() - new Date(att.last_released_at).getTime()) / 60000 : 999;
    if (restElapsed < EXECUTE_MIN_REST_MINUTES) {
      slog("reservation_execute_waiting_rest", { reservation_id: r.id, rest_min: Math.round(restElapsed) });
      continue;
    }

    // Auto empty-table re-fill (cron pre-assign), NOT a manual open → NO open-table
    // warmup grace, same as the fillEmptyTables auto path. Warmup is reserved for the
    // manual "Gán" / "Gán loạt" opens. (Owner 2026-07-06: "warmup chỉ dành cho mở bàn";
    // before this, a reserved dealer re-seating a post-swing empty table flashed WARMUP.)
    const swingDueAt = new Date(Date.now() + durMin * 60_000).toISOString();
    const { data: ex, error: executeError } = await admin.rpc("execute_empty_table_reservation_v2", {
      p_reservation_id: r.id,
      p_table_session_id: r.table_session_id,
      p_swing_due_at: swingDueAt,
    });
    if (executeError) throw executeError;
    const outcome = (ex as any)?.outcome;
    if (outcome === "ok") {
      res.executed++;
      slog("reservation_executed", { reservation_id: r.id, table_id: r.table_id, attendance_id: r.attendance_id });
      tg(`✅ ${ment} đã vào ${tableName} (mở bàn trống).`);
    } else if (["table_occupied", "dealer_busy", "table_not_active", "table_session_changed", "table_repair_required", "table_club_mismatch", "conflict_active_assignment", "reservation_not_found"].includes(outcome)) {
      // Stale reservation (table got staffed / dealer taken elsewhere) → cancel.
      await cancel(r.id, outcome);
      slog("reservation_cancelled", { reservation_id: r.id, reason: outcome });
    } else if (outcome === "reservation_identity_changed") throw new Error("reservation_identity_changed");
    else if (!["dealer_not_ready", "dealer_rest_required"].includes(outcome)) throw new Error("reservation_execute_unverified");
    // dealer_not_ready → leave for a later tick (shouldn't happen: we checked available).
  }

  // ── 2. RESERVE empty active tables with a soon-free on_break dealer ─────────
  // (Step-1 fill already staffed any table with an immediately-available dealer;
  //  this targets tables still empty because nobody is free RIGHT NOW.)
  if (!tables?.length) return res;

  const tableIds = tables.map((t: any) => t.id);
  const { data: occ, error: occupiedError } = await admin
    .from("dealer_assignments")
    .select("table_id")
    .in("status", ["assigned", "on_break", "reserved"])
    .is("released_at", null)
    .in("table_id", tableIds);
  if (occupiedError) throw occupiedError;
  if (!Array.isArray(occ)) throw new Error("reservation_occupancy_unverified");
  const occupied = new Set((occ ?? []).map((a: any) => a.table_id));

  const emptyTables = tables
    .filter((t: any) => !occupied.has(t.id))
    .sort((a: any, b: any) => (b.current_blind_level ?? 0) - (a.current_blind_level ?? 0));
  if (!emptyTables.length) return res;

  // Soon-free candidates (reservationMode admits dealers whose rest completes
  // within the planning horizon). Step 2 targets ON_BREAK dealers only — an
  // available dealer would have been used by Step-1 immediate fill.
  const supplyResult = await buildRotationSupply(admin, clubId, { minInterSwingRestMinutes: restMin });
  if (supplyResult.status !== "ok") {
    res.candidateStatus = supplyResult.status;
    res.candidateErrorCode = supplyResult.errorCode ?? `candidate_snapshot_${supplyResult.status}`;
    slog("candidate_snapshot_unavailable", {
      status: res.candidateStatus,
      error_code: res.candidateErrorCode,
    });
    return res;
  }
  const { supply } = supplyResult;
  const candidates = (supply ?? [])
    .filter((c: any) => c.current_state === "on_break")
    .sort((a: any, b: any) => (a.eligible_at_ms ?? 0) - (b.eligible_at_ms ?? 0));

  let ci = 0;
  for (const table of emptyTables) {
    if (ci >= candidates.length) {
      slog("reservation_skipped_no_candidate", { table_id: table.id });
      break;
    }
    const cand = candidates[ci];
    ci++; // consume this candidate regardless of outcome (avoid re-trying same dealer)
    const predictedArrival = new Date(cand.eligible_at_ms ?? Date.now()).toISOString();
    const { data: rv, error: reserveError } = await admin.rpc("reserve_empty_table_for_dealer_v2", {
      p_table_id: table.id,
      p_table_session_id: table.table_session_id,
      p_attendance_id: cand.id,
      p_predicted_arrival: predictedArrival,
      p_club_id: clubId,
    });
    if (reserveError) throw reserveError;
    const outcome = (rv as any)?.outcome;
    if (outcome === "ok" || outcome === "already_reserved") {
      if (outcome === "ok") {
        res.reserved++;
        const minsLeft = Math.max(0, Math.round(((cand.eligible_at_ms ?? Date.now()) - Date.now()) / 60000));
        slog("reservation_created", { table_id: table.id, attendance_id: cand.id, mins_left: minsLeft });
        tg(`📋 Mở bàn ${table.table_name}: ${mention({ full_name: cand.full_name, telegram_username: cand.telegram_username ?? null })} vào sau ~${minsLeft} phút (đang nghỉ).`);
      }
    } else if (["table_club_mismatch", "table_session_changed", "table_repair_required", "dealer_not_found", "dealer_not_on_break", "table_occupied", "dealer_busy", "race_lost"].includes(outcome)) {
      slog("reservation_skipped", { table_id: table.id, attendance_id: cand.id, outcome });
    } else throw new Error("reservation_create_unverified");
  }

  return res;
}
