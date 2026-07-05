// ═══════════════════════════════════════════════════════════════════════════
// Step 2 — predictive pre-assign of a soon-free (on_break) dealer to an EMPTY
// active table, then execute when the dealer's break ends.
//
// Self-contained pass so the footprint in the process-swing monolith stays tiny
// (process-swing just calls runEmptyTablePreAssign() once per club, behind the
// per-club AUTO_PREASSIGN_EMPTY_TABLES_CLUB_IDS env flag, default OFF).
//
// All reservation mutations go through the SECURITY DEFINER RPCs from migration
// 20260830000000 — never a raw UPDATE of reservation rows:
//   reserve_empty_table_for_dealer / execute_empty_table_reservation /
//   cancel_empty_table_reservation
//
// Invariants: never opens a new table; never pulls a dealer off break early
// (execute waits for current_state='available' + the 13-min rest gate); the
// reserved dealer stays on_break until they naturally free up.
// ═══════════════════════════════════════════════════════════════════════════

import { buildRotationSupply } from "../../_shared/pickNextDealer.ts";
import { sendTelegramNotification, mention } from "../../_shared/telegram.ts";
import { OPEN_TABLE_GRACE_MINUTES } from "../../_shared/openTableGrace.ts";

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
  const { data: reservations } = await admin
    .from("dealer_assignments")
    .select("id, table_id, attendance_id, pre_assigned_at, game_tables(table_name), dealers(full_name, telegram_username)")
    .eq("club_id", clubId)
    .eq("status", "reserved")
    .is("released_at", null);

  for (const r of reservations ?? []) {
    const tableName = (r as any).game_tables?.table_name ?? r.table_id;
    const dealer = (r as any).dealers ?? { full_name: "Dealer" };
    const ment = mention({ full_name: dealer.full_name, telegram_username: dealer.telegram_username ?? null });

    const { data: att } = await admin
      .from("dealer_attendance")
      .select("current_state, status, last_released_at")
      .eq("id", r.attendance_id)
      .maybeSingle();

    // Dealer gone / checked out → cancel the reservation.
    if (!att || att.status !== "checked_in" || att.current_state === "checked_out") {
      await admin.rpc("cancel_empty_table_reservation", { p_reservation_id: r.id, p_reason: "dealer_gone" });
      res.cancelled++;
      slog("reservation_cancelled", { reservation_id: r.id, reason: "dealer_gone" });
      continue;
    }

    // Still resting → wait, unless the reservation has gone stale.
    if (att.current_state === "on_break") {
      const ageMin = r.pre_assigned_at
        ? (Date.now() - new Date(r.pre_assigned_at).getTime()) / 60000 : 0;
      if (ageMin > RESERVATION_STALE_MINUTES) {
        await admin.rpc("cancel_empty_table_reservation", { p_reservation_id: r.id, p_reason: "stale_never_freed" });
        res.cancelled++;
        slog("reservation_cancelled", { reservation_id: r.id, reason: "stale", age_min: Math.round(ageMin) });
      }
      continue;
    }

    // Committed elsewhere somehow (assigned/pre_assigned/in_transition) → skip;
    // the execute RPC would no-op, and the dealer is busy on a real table.
    if (att.current_state !== "available") continue;

    // available → enforce the 13-min execute rest gate (never short rest).
    const restElapsed = att.last_released_at
      ? (Date.now() - new Date(att.last_released_at).getTime()) / 60000 : 999;
    if (restElapsed < EXECUTE_MIN_REST_MINUTES) {
      slog("reservation_execute_waiting_rest", { reservation_id: r.id, rest_min: Math.round(restElapsed) });
      continue;
    }

    const swingDueAt = new Date(Date.now() + (OPEN_TABLE_GRACE_MINUTES + durMin) * 60_000).toISOString();
    const { data: ex } = await admin.rpc("execute_empty_table_reservation", {
      p_reservation_id: r.id,
      p_swing_due_at: swingDueAt,
    });
    const outcome = (ex as any)?.outcome;
    if (outcome === "ok") {
      res.executed++;
      slog("reservation_executed", { reservation_id: r.id, table_id: r.table_id, attendance_id: r.attendance_id });
      tg(`✅ ${ment} đã vào ${tableName} (mở bàn trống).`);
    } else if (["table_occupied", "dealer_busy", "table_not_active", "conflict_active_assignment", "reservation_not_found"].includes(outcome)) {
      // Stale reservation (table got staffed / dealer taken elsewhere) → cancel.
      await admin.rpc("cancel_empty_table_reservation", { p_reservation_id: r.id, p_reason: outcome });
      res.cancelled++;
      slog("reservation_cancelled", { reservation_id: r.id, reason: outcome });
    }
    // dealer_not_ready → leave for a later tick (shouldn't happen: we checked available).
  }

  // ── 2. RESERVE empty active tables with a soon-free on_break dealer ─────────
  // (Step-1 fill already staffed any table with an immediately-available dealer;
  //  this targets tables still empty because nobody is free RIGHT NOW.)
  const { data: tables } = await admin
    .from("game_tables")
    .select("id, table_name, current_blind_level")
    .eq("club_id", clubId)
    .eq("status", "active");
  if (!tables?.length) return res;

  const tableIds = tables.map((t: any) => t.id);
  const { data: occ } = await admin
    .from("dealer_assignments")
    .select("table_id")
    .in("status", ["assigned", "on_break", "reserved"])
    .is("released_at", null)
    .in("table_id", tableIds);
  const occupied = new Set((occ ?? []).map((a: any) => a.table_id));

  const emptyTables = tables
    .filter((t: any) => !occupied.has(t.id))
    .sort((a: any, b: any) => (b.current_blind_level ?? 0) - (a.current_blind_level ?? 0));
  if (!emptyTables.length) return res;

  // Soon-free candidates (reservationMode admits dealers whose rest completes
  // within the planning horizon). Step 2 targets ON_BREAK dealers only — an
  // available dealer would have been used by Step-1 immediate fill.
  const { supply } = await buildRotationSupply(admin, clubId, { minInterSwingRestMinutes: restMin });
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
    const { data: rv } = await admin.rpc("reserve_empty_table_for_dealer", {
      p_table_id: table.id,
      p_attendance_id: cand.id,
      p_predicted_arrival: predictedArrival,
      p_club_id: clubId,
    });
    const outcome = (rv as any)?.outcome;
    if (outcome === "ok" || outcome === "already_reserved") {
      if (outcome === "ok") {
        res.reserved++;
        const minsLeft = Math.max(0, Math.round(((cand.eligible_at_ms ?? Date.now()) - Date.now()) / 60000));
        slog("reservation_created", { table_id: table.id, attendance_id: cand.id, mins_left: minsLeft });
        tg(`📋 Mở bàn ${table.table_name}: ${mention({ full_name: cand.full_name, telegram_username: cand.telegram_username ?? null })} vào sau ~${minsLeft} phút (đang nghỉ).`);
      }
    } else {
      slog("reservation_skipped", { table_id: table.id, attendance_id: cand.id, outcome });
    }
  }

  return res;
}
