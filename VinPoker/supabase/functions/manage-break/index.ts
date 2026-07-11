/**
 * manage-break/index.ts
 *
 * [FIX-Timeout] Telegram calls wrapped in withTimeout (5s) — never block response
 * [FIX-Return] Critical path returns before Telegram side-effect
 * [FIX-TournamentBreak] tournament_break action uses single atomic DB RPC
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  sendTelegramNotification,
  getClubTelegramChatId,
  notifyDealerDM,
  formatTournamentBreakMessage,
  formatBreakMessage,
} from "../_shared/telegram.ts";
import { startMealBreak, endMealBreak } from "../_shared/mealBreakService.ts";
import { idempotentResponse } from "../_shared/idempotency.ts";
import { authenticateUser } from "../_shared/staking-common.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T | null> {
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => {
      console.warn(`[Timeout] ${label} exceeded ${ms}ms — skipping`);
      resolve(null);
    }, ms);
  });
  return Promise.race([promise, timeout]);
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");

    const authResult = await authenticateUser(req);
    if (authResult instanceof Response) return authResult;
    const uid = authResult.uid;

    const body = await req.json().catch(() => ({}));
    const { action, attendance_id, club_id, duration_minutes = 20 } = body;
    if (!club_id) return json({ error: "club_id required" }, 400);

    const { data: isControl } = await admin.rpc("is_club_dealer_control", {
      _user_id: uid,
      _club_id: club_id,
    });
    if (!isControl) return json({ error: "Forbidden" }, 403);

    // Log every incoming call for traceability (cross-club leak investigations)
    const callerIp = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
    console.log(
      `[manage-break] action=${action} attendance_id=${attendance_id} ` +
      `club_id=${club_id} caller_ip=${callerIp}`
    );

    switch (action) {
    case "start": {
      // B1.2 — idempotent on an optional client key (dedups double-click/retry; avoids the
      // open-break double-extend + concurrent duplicate break rows). Degrades to a plain run pre-apply.
      const idemKeyStart = (body?.idempotency_key as string | undefined) ?? null;
      return await idempotentResponse(admin, {
        key: idemKeyStart, scope: "manage-break:start", clubId: club_id ?? null, actorId: uid,
        fingerprint: { action: "start", club_id, attendance_id, duration_minutes },
        json: (b, s) => json(b, s),
        run: async (): Promise<Response> => {
      // Allow starting break from either assigned dealers or checked-in dealers
      // already sitting in the pool. If the dealer has assignment history,
      // reuse the latest assignment as the break carrier; otherwise create an
      // attendance-backed break row so the pool can still render it.
      const { data: att, error: attErr } = await admin
        .from("dealer_attendance")
        .select("id, current_state, status, last_released_at, pool_entered_at, dealers!inner(club_id, full_name, telegram_user_id)")
        .eq("id", attendance_id)
        .eq("status", "checked_in")
        .maybeSingle();

      if (attErr || !att) {
        return json({ error: "Không tìm thấy dealer attendance" }, 404);
      }

      const attDealer = (att as any).dealers as any;
      if (attDealer?.club_id !== club_id) {
        console.error(
          `[manage-break] Club mismatch (safety): attendance=${attendance_id} ` +
          `dealer_club=${attDealer?.club_id} request_club=${club_id}`
        );
        return json({ error: "Attendance does not belong to this club" }, 403);
      }

      if (!["available", "assigned", "on_break"].includes(att.current_state)) {
        return json({ error: `Dealer không sẵn sàng (trạng thái: ${att.current_state})` }, 400);
      }

      const { data: activeAssignment } = await admin
        .from("dealer_assignments")
        .select("id, version, status, assigned_at, released_at, game_tables!inner(club_id, table_name)")
        .eq("attendance_id", attendance_id)
        .in("status", ["assigned", "on_break"])
        .order("assigned_at", { ascending: false })
        .maybeSingle();

      let latestAssignment: typeof activeAssignment | null = null;
      if (!activeAssignment) {
        const { data } = await admin
          .from("dealer_assignments")
          .select("id, version, status, assigned_at, released_at, game_tables!inner(club_id, table_name)")
          .eq("attendance_id", attendance_id)
          .order("assigned_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        latestAssignment = data ?? null;
      }

      const assignment = activeAssignment ?? latestAssignment;
      if (assignment) {
        const gameTable = Array.isArray(assignment.game_tables)
          ? assignment.game_tables[0]
          : assignment.game_tables;
        if (gameTable?.club_id !== club_id) {
          console.error(
            `[manage-break] Club mismatch (safety): attendance=${attendance_id} ` +
            `table_club=${gameTable?.club_id} request_club=${club_id}`
          );
          return json({ error: "Attendance does not belong to this club" }, 403);
        }
      }

      const nowIso = new Date().toISOString();
      const { data: restCfg } = await admin
        .from("swing_config")
        .select("min_inter_swing_rest_minutes")
        .eq("club_id", club_id)
        .eq("table_type", "tournament")
        .maybeSingle();
      const restWindowMinutes = restCfg?.min_inter_swing_rest_minutes ?? 10;
      const restEntryAt = att.pool_entered_at ?? att.last_released_at;
      const lastReleasedAtMs = restEntryAt ? new Date(restEntryAt).getTime() : 0;
      const nowMs = Date.now();
      const elapsedRestMinutes = lastReleasedAtMs > 0 ? Math.max(0, Math.floor((nowMs - lastReleasedAtMs) / 60_000)) : 0;
      const isRecentRest = att.current_state === "available" && lastReleasedAtMs > 0 && elapsedRestMinutes < restWindowMinutes;
      const openBreakQuery = admin
        .from("dealer_breaks")
        .select("id, break_start, expected_duration_minutes")
        .eq("attendance_id", attendance_id)
        .is("break_end", null)
        .order("break_start", { ascending: false })
        .limit(1);
      const { data: openBreakByAttendance, error: breakErr } = await openBreakQuery.maybeSingle();
      if (breakErr) {
        return json({ error: breakErr.message }, 500);
      }

      let openBreak = openBreakByAttendance ?? null;
      if (!openBreak && assignment?.id) {
        const { data: openBreakByAssignment, error: assignmentBreakErr } = await admin
          .from("dealer_breaks")
          .select("id, break_start, expected_duration_minutes")
          .eq("assignment_id", assignment.id)
          .is("break_end", null)
          .order("break_start", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (assignmentBreakErr) {
          return json({ error: assignmentBreakErr.message }, 500);
        }
        openBreak = openBreakByAssignment ?? null;
      }

      if (openBreak) {
        const elapsedMinutes = Math.max(
          0,
          Math.floor((Date.now() - new Date(openBreak.break_start).getTime()) / 60_000),
        );
        const newExpectedDuration = Math.max(
          openBreak.expected_duration_minutes ?? 0,
          elapsedMinutes + duration_minutes,
        );

        const { error: updateBreakErr } = await admin
          .from("dealer_breaks")
          .update({
            expected_duration_minutes: newExpectedDuration,
            reason: "manual_extend",
          })
          .eq("id", openBreak.id);

        if (updateBreakErr) {
          return json({ error: `Failed to extend break: ${updateBreakErr.message}` }, 500);
        }

        if (att.current_state !== "on_break") {
          const { data: stateResult } = await admin.rpc("transition_dealer_state", {
            p_attendance_id: attendance_id,
            p_new_state: "on_break",
            p_reason: "manage_break_extend",
          });
          if (stateResult?.ok === false) {
            console.error(`[manage-break] State transition failed while extending break: ${stateResult.error}`);
            return json({ error: `State transition failed: ${stateResult.error}` }, 500);
          }
        }

        return json({
          ok: true,
          action: "extended",
          break_minutes: newExpectedDuration,
          added_minutes: duration_minutes,
        });
      }

      const insertedDurationMinutes = isRecentRest
        ? elapsedRestMinutes + duration_minutes
        : duration_minutes;

      if (assignment && assignment.status !== "on_break") {
        const { error: casErr } = await admin
          .from("dealer_assignments")
          .update({ status: "on_break", version: assignment.version + 1 })
          .eq("id", assignment.id)
          .eq("version", assignment.version);

        if (casErr) return json({ error: "CAS conflict, try again" }, 409);
      }

      const { error: insertBreakErr } = await admin.from("dealer_breaks").insert({
        assignment_id: assignment?.id ?? null,
        attendance_id,
        club_id,
        break_start: nowIso,
        expected_duration_minutes: insertedDurationMinutes,
        reason: isRecentRest ? "manual_rest_extend" : att.current_state === "available" ? "manual_available" : "manual",
      });
      if (insertBreakErr) {
        return json({ error: insertBreakErr.message }, 500);
      }

      const { data: stateResult } = await admin.rpc("transition_dealer_state", {
        p_attendance_id: attendance_id,
        p_new_state: "on_break",
        p_reason: "manage_break_start",
      });
      if (stateResult?.ok === false) {
        console.error(`[manage-break] State transition failed: ${stateResult.error}`);
        return json({ error: `State transition failed: ${stateResult.error}` }, 500);
      }

      // === CRITICAL PATH DONE — return immediately ===
      const response = json({ ok: true, action: "started" });

      // === SIDE EFFECT — Telegram sent async, no await ===
      if (botToken) {
        withTimeout(
          (async () => {
            const { data: dealer } = await admin
              .from("dealer_attendance")
              .select("dealers(full_name, telegram_user_id, telegram_username)")
              .eq("id", attendance_id)
              .single();

            const dealerInfo = Array.isArray(dealer?.dealers)
              ? dealer.dealers[0]
              : dealer?.dealers;
            if (!dealerInfo) return;
            const name = dealerInfo.full_name ?? "Dealer";
            const chatId = await getClubTelegramChatId(admin as any, club_id);
            if (chatId) {
              await sendTelegramNotification(
                botToken,
                chatId,
                formatBreakMessage({ dealer: { full_name: name }, durationMinutes: duration_minutes }),
                {}
              );
            }
          })(),
          5000,
          "manage-break Telegram notification"
        ).catch((err) => {
          console.warn("[manage-break] Telegram side-effect error:", err);
        });
      }

      return response;
        },
      });
    }

    case "end":
    case "return_from_break": {
      // Validate the attendance's dealer belongs to the requested club
      // before calling complete_dealer_break. Prevents ending another club's break.
      const { data: breakCheck } = await admin
        .from("dealer_attendance")
        .select("dealers!inner(club_id)")
        .eq("id", attendance_id)
        .eq("status", "checked_in")
        .eq("dealers.club_id", club_id)
        .maybeSingle();

      if (!breakCheck) {
        return json({ error: "No active attendance found for this club" }, 404);
      }

      const { data: rpcResult, error: rpcErr } = await admin.rpc(
        "complete_dealer_break",
        { p_attendance_id: attendance_id }
      );

      if (rpcErr) return json({ error: rpcErr.message }, 500);
      return json({ ok: true, result: rpcResult });
    }

    case "tournament_break": {
      // B1.2 — idempotent on an optional client key (bulk all-table break; avoid double-breaking).
      const idemKeyTb = (body?.idempotency_key as string | undefined) ?? null;
      return await idempotentResponse(admin, {
        key: idemKeyTb, scope: "manage-break:tournament_break", clubId: club_id ?? null, actorId: uid,
        fingerprint: { action: "tournament_break", club_id, duration_minutes },
        json: (b, s) => json(b, s),
        run: async (): Promise<Response> => {
      const { data: rpcResult, error: rpcErr } = await admin.rpc(
        "tournament_break_all_tables",
        {
          p_club_id: club_id,
          p_duration_minutes: duration_minutes,
          p_reason: "tournament_break",
        }
      );

      if (rpcErr) {
        console.error("[manage-break] tournament_break_all_tables RPC error:", rpcErr.message);
        return json({ error: rpcErr.message }, 500);
      }

      const affectedDealers: Array<{
        attendance_id: string;
        full_name: string;
        telegram_user_id?: string;
        table_name: string;
      }> = rpcResult?.affected_dealers ?? [];

      const tableCount = affectedDealers.length;

      const response = json({
        ok: true,
        affected_tables: tableCount,
        duration_minutes,
      });

      if (botToken && tableCount > 0) {
        withTimeout(
          (async () => {
            const chatId = await getClubTelegramChatId(admin as any, club_id);
            if (chatId) {
              await sendTelegramNotification(
                botToken,
                chatId,
                formatTournamentBreakMessage({
                  durationMinutes: duration_minutes,
                  dealerCount: tableCount,
                  tableCount,
                }),
                {}
              );
            }

            const dmPromises = affectedDealers
              .filter((d) => d.telegram_user_id)
              .map((d) =>
                notifyDealerDM(
                  botToken,
                  { telegram_user_id: d.telegram_user_id as any, full_name: d.full_name },
                  `⏸ TOURNAMENT BREAK: ${duration_minutes} phút. Nghỉ ngơi đi nhé!`
                )
              );
            await Promise.allSettled(dmPromises);
          })(),
          5000,
          "manage-break tournament Telegram"
        ).catch((err) => {
          console.warn("[manage-break] Tournament Telegram side-effect error:", err);
        });
      }

      return response;
        },
      });
    }

    case "meal_break": {
      const { data: att } = await admin
        .from("dealer_attendance")
        .select("id, dealer_id, current_state, status, dealers!inner(club_id, full_name, telegram_user_id)")
        .eq("id", attendance_id)
        .eq("status", "checked_in")
        .maybeSingle();

      if (!att) {
        return json({ error: "Không tìm thấy dealer attendance" }, 404);
      }

      const attDealer = att.dealers as any;
      if (attDealer?.club_id !== club_id) {
        return json({ error: "Attendance does not belong to this club" }, 403);
      }

      if (att.current_state !== "available") {
        return json({ error: `Dealer không sẵn sàng (trạng thái: ${att.current_state})` }, 400);
      }

      const result = await startMealBreak(admin, att.id, club_id, att.dealer_id);

      if (!result.ok) {
        const status = result.error?.includes("7 tiếng") ? 429 : 500;
        return json({ error: result.error }, status);
      }

      // Telegram notification
      if (botToken) {
        withTimeout(
          (async () => {
            const chatId = await getClubTelegramChatId(admin as any, club_id);
            if (chatId) {
              await sendTelegramNotification(
                botToken,
                chatId,
                `🍚 ${attDealer?.full_name ?? "Dealer"} nghỉ ăn cơm: ${result.totalDuration}p (${result.baseDuration}p + ${result.bonusMinutes}p bonus)`,
                {},
              );
            }
            if (attDealer?.telegram_user_id) {
              await notifyDealerDM(
                botToken,
                { telegram_user_id: attDealer.telegram_user_id, full_name: attDealer?.full_name },
                `🍚 Đã đăng ký nghỉ ăn cơm! ${result.totalDuration} phút. Hết giờ sẽ tự động trở lại pool.`,
              );
            }
          })(),
          5000,
          "manage-break meal_break Telegram notification",
        ).catch(() => {});
      }

      return json({
        ok: true,
        action: "meal_break",
        base_duration_minutes: result.baseDuration,
        bonus_minutes: result.bonusMinutes,
        total_duration_minutes: result.totalDuration,
      });
    }

    case "end_meal_break": {
      const result = await endMealBreak(admin, attendance_id);
      if (!result.ok) {
        return json({ error: result.error }, 500);
      }
      return json({ ok: true, already_ended: result.alreadyEnded ?? false });
    }

    default:
      return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("[manage-break] Unhandled error:", err);
    return json({ error: "Internal error" }, 500);
  }
});
