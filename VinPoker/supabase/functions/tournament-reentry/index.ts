// PATCH 4 / STAGE B — player self-initiated tournament RE-ENTRY (pay-first).
// Creates a PENDING re-entry registration (REENTRY code) + returns CLB bank info — the SAME response shape
// as tournament-register, so TournamentRegisterModal + the dynamic VietQR render unchanged. NO seat is drawn
// here; the seat is drawn only after payment (settle → confirm_reentry_and_assign_seat, STAGE C).
//
// Gates (all enforced server-side, before any write):
//   1. caller is the player (auth.uid()) and their LATEST entry in this tournament is 'busted' (floor removed
//      them — STAGE A mirrors the floor "Loại" onto entry.status) AND they hold no active seat;
//   2. re-entry window open: tournament not completed/cancelled AND (current_level IS NULL OR
//      current_level <= COALESCE(late_reg_close_level, 6));
//   3. no live re-entry already exists for that busted entry (resume the pending one instead of duplicating).
// Re-entry pays the FULL cost (buy_in + rake + service_fee) and does NOT consume a free-rake slot.
import { createClient } from "npm:@supabase/supabase-js@2.105.4";

import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({ tournament_id: z.string().uuid() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return j({ error: "Missing auth" }, 401);

    // SERVER-SIDE KILL-SWITCH (default OFF). The endpoint is disabled until REENTRY_ENABLED='true' is set in
    // this function's env. Returns a safe error BEFORE getUser / body-parse / any DB write or QR payload — so a
    // direct authenticated API call cannot create a re-entry registration while the feature is dark.
    // (dynamicReentry only hides the UI button; this gate disables the endpoint itself.) Flip on for the
    // Stage-D smoke; remove/keep per launch. Unauthorized requests still hit the 401 above first.
    if ((Deno.env.get("REENTRY_ENABLED") ?? "").trim().toLowerCase() !== "true") {
      return j({ error: "REENTRY_DISABLED" }, 403);
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader }, fetch: retryFetch } },
    );
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: cErr } = await userClient.auth.getUser(token);
    if (cErr || !userData?.user?.id) return j({ error: "Invalid token" }, 401);
    const uid = userData.user.id;

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Tournament + window fields
    const { data: tour, error: tErr } = await admin
      .from("tournaments")
      .select("id, name, buy_in, status, club_id, rake_amount, current_level, late_reg_close_level")
      .eq("id", body.tournament_id)
      .maybeSingle();
    if (tErr || !tour) return j({ error: "Tournament not found" }, 404);

    // PER-CLUB GATE: online re-entry is available ONLY for clubs opted into SePay auto-confirm (the system bot
    // is a cashier of the club). This ties re-entry to the per-club opt-in, so it neither runs nor falls to the
    // (re-entry-unaware) cashier manual-confirm path for clubs that haven't been launched. dynamicReentry (UI)
    // is a GLOBAL flag; THIS is the real per-club switch. Opt a club in by adding the bot to its club_cashiers.
    {
      const { data: ss } = await admin.from("sepay_system_settings").select("system_actor_id").limit(1).maybeSingle();
      const botId = (ss as { system_actor_id?: string | null } | null)?.system_actor_id ?? null;
      let clubEnabled = false;
      if (botId && tour.club_id) {
        const { data: cc } = await admin.from("club_cashiers").select("user_id")
          .eq("club_id", tour.club_id).eq("user_id", botId).limit(1).maybeSingle();
        clubEnabled = !!cc;
      }
      if (!clubEnabled) return j({ error: "Giải này chưa mở mua lại online." }, 403);
    }

    // Gate 2 — re-entry window open (before registration closes).
    if (["completed", "cancelled"].includes(String(tour.status))) {
      return j({ error: "Giải đã kết thúc — không thể mua lại." }, 400);
    }
    const lvl = (tour as { current_level: number | null }).current_level;
    const closeLvl = Number((tour as { late_reg_close_level: number | null }).late_reg_close_level ?? 6);
    if (lvl != null && Number(lvl) > closeLvl) {
      return j({ error: "Đã hết giờ đăng ký (đóng late-reg) — không thể mua lại." }, 400);
    }

    // Gate 1a — the player's LATEST entry in this tournament must be 'busted' (floor-removed).
    const { data: srcEntry } = await admin
      .from("tournament_entries")
      .select("id, status, entry_no")
      .eq("tournament_id", tour.id)
      .eq("player_id", uid)
      .order("entry_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!srcEntry) return j({ error: "Bạn chưa từng vào giải này." }, 400);
    if (srcEntry.status !== "busted") {
      // 'seated' = still in; 'finished'/'cancelled' = not re-enterable
      return j({ error: "Bạn chưa bị loại khỏi giải (chỉ mua lại khi đã cháy + floor cho ra)." }, 400);
    }

    // Gate 1b — must hold NO active seat (belt: floor freed it).
    const { data: activeSeat } = await admin
      .from("tournament_seats")
      .select("id")
      .eq("tournament_id", tour.id)
      .eq("player_id", uid)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (activeSeat) return j({ error: "Bạn vẫn đang có ghế — không thể mua lại." }, 400);

    // Bank account: prefer club's active bank, fallback platform-wide active (same as tournament-register).
    let bank: any = null;
    if (tour.club_id) {
      const { data: clubBank } = await admin
        .from("platform_bank_accounts")
        .select("id, bank_name, account_number, account_holder, qr_code_url")
        .eq("is_active", true)
        .eq("club_id", tour.club_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      bank = clubBank;
    }
    if (!bank) {
      const { data: fb } = await admin
        .from("platform_bank_accounts")
        .select("id, bank_name, account_number, account_holder, qr_code_url")
        .eq("is_active", true)
        .is("club_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      bank = fb;
    }
    if (!bank) return j({ error: "CLB chưa cấu hình tài khoản nhận tiền." }, 400);

    // bank_bin (VietQR) — guarded select (safe whether or not the Stage-2 column is applied).
    let bankBin: string | null = null;
    {
      const { data: bb, error: bbErr } = await admin
        .from("platform_bank_accounts")
        .select("bank_bin")
        .eq("id", bank.id)
        .maybeSingle();
      if (!bbErr && bb) bankBin = (bb as { bank_bin?: string | null }).bank_bin ?? null;
    }

    // Re-entry cost = buy_in + rake + service_fee (NO free-rake). service_fee guarded (may be unapplied → 0).
    const rakeAmount = Number(tour.rake_amount ?? 0);
    let serviceFee = 0;
    {
      const { data: sf, error: sfErr } = await admin
        .from("tournaments")
        .select("service_fee_amount")
        .eq("id", tour.id)
        .maybeSingle();
      if (!sfErr && sf) serviceFee = Number((sf as { service_fee_amount?: number }).service_fee_amount ?? 0);
    }
    const totalPay = Number(tour.buy_in) + rakeAmount + serviceFee;

    const breakdown = {
      buy_in: Number(tour.buy_in),
      club_fee: rakeAmount,       // shown as "Phí câu lạc bộ" (rake); re-entry never waives it
      service_fee: serviceFee,
      platform_fee: 0,
    };

    // Gate 3 — resume an existing live re-entry for this busted entry instead of duplicating.
    const { data: existing } = await admin
      .from("tournament_registrations")
      .select("id, status, reference_code, total_pay, transfer_proof_image_url, transfer_proof_submitted, committed_at")
      .eq("source_entry_id", srcEntry.id)
      .in("status", ["pending", "confirmed"])
      .maybeSingle();
    if (existing) {
      if (existing.status === "confirmed") {
        return j({ error: "Lượt mua lại này đã được xác nhận." }, 400);
      }
      // pending → return it so the modal resumes the same QR
      return j({
        success: true,
        reentry: true,
        already_registered: true,
        registration_id: existing.id,
        status: existing.status,
        reference_code: existing.reference_code,
        total_pay: Number(existing.total_pay),
        breakdown,
        bank_name: bank.bank_name,
        account_number: bank.account_number,
        account_holder: bank.account_holder,
        qr_code_url: bank.qr_code_url,
        bank_bin: bankBin,
        transfer_proof_url: existing.transfer_proof_image_url,
        transfer_proof_submitted: existing.transfer_proof_submitted,
        committed_at: existing.committed_at,
        free_rake_applied: false,
        savings: 0,
      });
    }

    // Create the PENDING re-entry registration (no seat; pay-first). source_entry_id links the busted entry.
    const refCode = "REENTRY-" +
      crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();

    const { data: ins, error: insErr } = await admin
      .from("tournament_registrations")
      .insert({
        tournament_id: tour.id,
        player_id: uid,
        club_id: tour.club_id,
        buy_in: tour.buy_in,
        platform_fixed_fee: 0,
        total_pay: totalPay,
        reference_code: refCode,
        status: "pending",
        source_entry_id: srcEntry.id,
        used_free_rake: false,
      })
      .select("id")
      .single();
    if (insErr) return j({ error: insErr.message }, 500);

    try {
      await admin.from("notifications").insert({
        user_id: uid,
        type: "registration_confirmed",
        title: "Yêu cầu mua lại giải",
        body: `Bạn đã tạo yêu cầu mua lại giải "${tour.name}". Vui lòng chuyển khoản để vào lại bàn.`,
        data: { tournament_id: tour.id, club_id: tour.club_id, reentry: true },
      });
    } catch (_) {
      // non-critical
    }

    return j({
      success: true,
      reentry: true,
      registration_id: ins.id,
      status: "pending",
      reference_code: refCode,
      total_pay: totalPay,
      breakdown,
      bank_name: bank.bank_name,
      account_number: bank.account_number,
      account_holder: bank.account_holder,
      qr_code_url: bank.qr_code_url,
      bank_bin: bankBin,
      committed_at: new Date().toISOString(),
      free_rake_applied: false,
      savings: 0,
    });
  } catch (e: any) {
    return j({ error: e?.message ?? "internal" }, 500);
  }
});

function j(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
