// Player self-register a tournament: creates a tournament_registration row and returns CLB bank info
// for the player to transfer the buy-in (+ optional platform fixed fee).
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

    // Tournament + club
    const { data: tour, error: tErr } = await admin
      .from("tournaments")
      .select("id, name, buy_in, start_time, status, club_id, rake_amount, free_rake_enabled, free_rake_slots, free_rake_used")
      .eq("id", body.tournament_id)
      .maybeSingle();
    if (tErr || !tour) return j({ error: "Tournament not found" }, 404);
    if (tour.start_time && new Date(tour.start_time as string).getTime() < Date.now() - 60 * 60 * 1000) {
      return j({ error: "Giải đã bắt đầu hoặc kết thúc." }, 400);
    }

    // Try consume a free_rake slot (atomic)
    let freeRakeApplied = false;
    const rakeAmount = Number(tour.rake_amount ?? 0);
    if (tour.free_rake_enabled) {
      const { data: consume, error: consumeErr } = await admin.rpc("try_consume_free_rake_slot", {
        _tournament_id: tour.id,
      });
      if (!consumeErr && consume === true) {
        freeRakeApplied = true;
      }
    }

    // Already-registered guard
    const { data: existing } = await admin
      .from("tournament_registrations")
      .select("id, status, reference_code, total_pay, buy_in, platform_fixed_fee, transfer_proof_image_url, transfer_proof_submitted, committed_at, used_free_rake")
      .eq("tournament_id", tour.id)
      .eq("player_id", uid)
      .in("status", ["pending", "confirmed"])
      .maybeSingle();

    // Bank account: prefer club's active bank (any type), fallback platform-wide active
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

    if (existing) {
      return j({
        success: true,
        already_registered: true,
        registration_id: existing.id,
        status: existing.status,
        reference_code: existing.reference_code,
        total_pay: Number(existing.total_pay),
        breakdown: {
          buy_in: Number(existing.buy_in),
          // club_fee (rake, shown as "Phí câu lạc bộ") = everything collected above the buy-in.
          club_fee: Math.max(0, Number(existing.total_pay) - Number(existing.buy_in)),
          service_fee: 0,
          platform_fee: Number(existing.platform_fixed_fee),
        },
        bank_name: bank.bank_name,
        account_number: bank.account_number,
        account_holder: bank.account_holder,
        qr_code_url: bank.qr_code_url,
        transfer_proof_url: existing.transfer_proof_image_url,
        transfer_proof_submitted: existing.transfer_proof_submitted,
        committed_at: existing.committed_at,
        free_rake_applied: existing.used_free_rake ?? false,
        savings: existing.used_free_rake ? rakeAmount : 0,
      });
    }

    // Per-tour SERVICE FEE (phí dịch vụ) — a SECOND configured charge, separate from rake, charged on
    // EVERY entry (free-rake waives the rake only). Read with a GUARDED separate select so this fn is
    // safe to deploy whether or not the `service_fee_amount` column has been applied yet (absent → 0).
    let serviceFee = 0;
    {
      const { data: sf, error: sfErr } = await admin
        .from("tournaments")
        .select("service_fee_amount")
        .eq("id", tour.id)
        .maybeSingle();
      if (!sfErr && sf) serviceFee = Number((sf as { service_fee_amount?: number }).service_fee_amount ?? 0);
    }

    // Tournament buy-in does NOT include platform fee
    // If free_rake applied, player only pays buy_in + service fee (rake waived; service fee still applies)
    const fixedFee = 0;
    const totalPay = (freeRakeApplied ? Number(tour.buy_in) : Number(tour.buy_in) + rakeAmount) + serviceFee;

    const refCode = "VINReg" +
      String(tour.id).replace(/-/g, "").slice(0, 4).toUpperCase() +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    const { data: ins, error: insErr } = await admin
      .from("tournament_registrations")
      .insert({
        tournament_id: tour.id,
        player_id: uid,
        club_id: tour.club_id,
        buy_in: tour.buy_in,
        platform_fixed_fee: fixedFee,
        total_pay: totalPay,
        reference_code: refCode,
        status: "pending",
        used_free_rake: freeRakeApplied,
      })
      .select("id")
      .single();
    if (insErr) return j({ error: insErr.message }, 500);

    try {
      await admin.from("notifications").insert({
        user_id: uid,
        type: "registration_confirmed",
        title: "Đăng ký giải thành công",
        body: `Bạn đã đăng ký giải "${tour.name}" thành công.`,
        data: { tournament_id: tour.id, club_id: tour.club_id },
      });
    } catch (_) {
      // non-critical; don't fail registration
    }

    return j({
      success: true,
      registration_id: ins.id,
      status: "pending",
      reference_code: refCode,
      total_pay: totalPay,
      breakdown: {
        buy_in: Number(tour.buy_in),
        // club_fee = rake (shown as "Phí câu lạc bộ" for VN legal wording); waived when free-rake applied.
        club_fee: freeRakeApplied ? 0 : rakeAmount,
        service_fee: serviceFee,
        platform_fee: fixedFee,
      },
      bank_name: bank.bank_name,
      account_number: bank.account_number,
      account_holder: bank.account_holder,
      qr_code_url: bank.qr_code_url,
      committed_at: new Date().toISOString(),
      free_rake_applied: freeRakeApplied,
      savings: freeRakeApplied ? rakeAmount : 0,
    });
  } catch (e: any) {
    return j({ error: e?.message ?? "internal" }, 500);
  }
});

function j(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
