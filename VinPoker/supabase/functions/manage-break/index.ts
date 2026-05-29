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

    const body = await req.json().catch(() => ({}));
    const { action, attendance_id, club_id, duration_minutes = 20 } = body;

    switch (action) {
    case "start": {
      const { data: assignment, error: aErr } = await admin
        .from("dealer_assignments")
        .select("id, version, table_id, game_tables(table_name)")
        .eq("attendance_id", attendance_id)
        .eq("status", "assigned")
        .single();

      if (aErr || !assignment) {
        return json({ error: "No active assignment found" }, 404);
      }

      const { error: casErr } = await admin
        .from("dealer_assignments")
        .update({ status: "on_break", version: assignment.version + 1 })
        .eq("id", assignment.id)
        .eq("version", assignment.version);

      if (casErr) return json({ error: "CAS conflict, try again" }, 409);

      await admin.from("dealer_breaks").insert({
        assignment_id: assignment.id,
        break_start: new Date().toISOString(),
        expected_duration_minutes: duration_minutes,
        reason: "manual",
      });

      await admin
        .from("dealer_attendance")
        .update({ current_state: "on_break" })
        .eq("id", attendance_id);

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

            if (!dealer?.dealers) return;
            const name = dealer.dealers.full_name ?? "Dealer";
            const chatId = await getClubTelegramChatId(admin, club_id);
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
    }

    case "end":
    case "return_from_break": {
      const { data: rpcResult, error: rpcErr } = await admin.rpc(
        "complete_dealer_break",
        { p_attendance_id: attendance_id }
      );

      if (rpcErr) return json({ error: rpcErr.message }, 500);
      return json({ ok: true, result: rpcResult });
    }

    case "tournament_break": {
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
            const chatId = await getClubTelegramChatId(admin, club_id);
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
    }

    default:
      return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("[manage-break] Unhandled error:", err);
    return json({ error: "Internal error" }, 500);
  }
});
