// Read-only, caller-authorized buy-in receipt snapshot.
//
// This function never confirms a payment, assigns a seat, writes a receipt, or
// sends a notification. It only assembles fields that a player cannot safely join
// from the browser (notably club_members.full_name) after verifying ownership or
// staff scope for exactly one registration / receipt code.
import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.105.4";

import { corsHeaders, handleOptions, jsonResp } from "../_shared/cors.ts";
import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";
import { canReadBuyinReceipt } from "./access.ts";

const LookupSchema = z.object({
  registration_id: z.string().uuid().optional(),
  receipt_code: z.string().trim().min(1).max(200).optional(),
}).superRefine((value, context) => {
  if (Boolean(value.registration_id) === Boolean(value.receipt_code)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide exactly one lookup key",
    });
  }
});

const registrationColumns =
  "id, tournament_id, player_id, club_id, total_pay, reference_code, status, confirmed_at";
const receiptColumns =
  "id, registration_id, tournament_id, player_id, display_name, table_number, seat_number, receipt_code, status, issued_at, cancelled_at";

type AdminClient = SupabaseClient<any>;

const numberOrNull = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

async function canManageReceiptClub(
  admin: AdminClient,
  callerId: string,
  clubId: string,
): Promise<boolean> {
  const { data: roles, error: rolesError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", callerId)
    .eq("role", "super_admin")
    .limit(1);
  if (rolesError) throw new Error(rolesError.message);
  if ((roles ?? []).length > 0) return true;

  const scope = { _user_id: callerId, _club_id: clubId };
  const { data: isOwner, error: ownerError } = await admin.rpc(
    "is_club_owner",
    scope,
  );
  if (ownerError) throw new Error(ownerError.message);
  if (isOwner === true) return true;

  const { data: isCashier, error: cashierError } = await admin.rpc(
    "is_club_cashier",
    scope,
  );
  if (cashierError) throw new Error(cashierError.message);
  return isCashier === true;
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  const headers = corsHeaders(req);
  if (req.method !== "POST") {
    return jsonResp(req, { error: "METHOD_NOT_ALLOWED" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResp(req, { error: "MISCONFIGURED" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResp(req, { error: "UNAUTHORIZED" }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader }, fetch: retryFetch },
      auth: { persistSession: false },
    });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await userClient.auth.getUser(
      token,
    );
    if (userError || !userData?.user?.id) {
      return jsonResp(req, { error: "UNAUTHORIZED" }, 401);
    }
    const callerId = userData.user.id;

    const parsed = await parseBody(req, LookupSchema, headers);
    if (!parsed.ok) return parsed.response;

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      global: { fetch: retryFetch },
      auth: { persistSession: false },
    });

    let registration: Record<string, any> | null = null;
    let receipt: Record<string, any> | null = null;

    if (parsed.data.registration_id) {
      const { data, error } = await admin
        .from("tournament_registrations")
        .select(registrationColumns)
        .eq("id", parsed.data.registration_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      registration = data as Record<string, any> | null;
    } else {
      const { data, error } = await admin
        .from("seat_draw_receipts")
        .select(receiptColumns)
        .eq("receipt_code", parsed.data.receipt_code!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      receipt = data as Record<string, any> | null;
      if (receipt?.registration_id) {
        const { data: registrationData, error: registrationError } = await admin
          .from("tournament_registrations")
          .select(registrationColumns)
          .eq("id", receipt.registration_id)
          .maybeSingle();
        if (registrationError) throw new Error(registrationError.message);
        registration = registrationData as Record<string, any> | null;
      }
    }

    if (!registration && !receipt) {
      return jsonResp(req, { error: "RECEIPT_NOT_FOUND" }, 404);
    }

    const tournamentId = registration?.tournament_id ?? receipt?.tournament_id;
    const playerId = registration?.player_id ?? receipt?.player_id;
    if (
      !tournamentId || !playerId || (registration && receipt &&
        (registration.tournament_id !== receipt.tournament_id ||
          registration.player_id !== receipt.player_id))
    ) {
      return jsonResp(req, { error: "RECEIPT_NOT_FOUND" }, 404);
    }

    const { data: tournament, error: tournamentError } = await admin
      .from("tournaments")
      .select("id, club_id, name, starting_stack")
      .eq("id", tournamentId)
      .maybeSingle();
    if (tournamentError) throw new Error(tournamentError.message);
    if (!tournament?.club_id) {
      return jsonResp(req, { error: "RECEIPT_NOT_FOUND" }, 404);
    }

    const isPlayer = callerId === playerId;
    const staffAuthorized = !isPlayer &&
      await canManageReceiptClub(admin, callerId, tournament.club_id);
    if (!canReadBuyinReceipt({ callerId, playerId, staffAuthorized })) {
      // Deliberately do not disclose whether another player's receipt exists.
      return jsonResp(req, { error: "RECEIPT_NOT_FOUND" }, 404);
    }

    if (!receipt && registration?.id) {
      const { data, error } = await admin
        .from("seat_draw_receipts")
        .select(receiptColumns)
        .eq("registration_id", registration.id)
        .is("cancelled_at", null)
        .order("issued_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      receipt = data as Record<string, any> | null;
    }

    const [clubResult, memberResult, profileResult] = await Promise.all([
      admin.from("clubs").select("name, address, tv_logo_url").eq(
        "id",
        tournament.club_id,
      ).maybeSingle(),
      admin.from("club_members").select("full_name").eq(
        "club_id",
        tournament.club_id,
      ).eq("player_user_id", playerId).order("updated_at", { ascending: false })
        .limit(1).maybeSingle(),
      admin.from("profiles").select("display_name").eq("user_id", playerId)
        .maybeSingle(),
    ]);
    if (clubResult.error || memberResult.error || profileResult.error) {
      throw new Error(
        clubResult.error?.message ?? memberResult.error?.message ??
          profileResult.error?.message,
      );
    }

    const memberName = (memberResult.data?.full_name ?? "").trim();
    const receiptName = (receipt?.display_name ?? "").trim();
    const profileName = (profileResult.data?.display_name ?? "").trim();
    const completedAt = registration?.confirmed_at ?? receipt?.issued_at ??
      null;

    return jsonResp(req, {
      receipt: {
        registration_id: registration?.id ?? receipt?.registration_id ?? null,
        receipt_code: receipt?.receipt_code ?? null,
        // Do not replace this with reference_code: operations scanners already rely on receipt_code.
        qr_value: receipt?.receipt_code ?? null,
        reference_code: registration?.reference_code ?? null,
        status: registration?.status ??
          (receipt?.cancelled_at ? "cancelled" : "confirmed"),
        club: {
          name: clubResult.data?.name ?? null,
          address: clubResult.data?.address ?? null,
          logo_url: clubResult.data?.tv_logo_url ?? null,
        },
        player_name: memberName || receiptName || profileName || null,
        tournament_name: tournament.name ?? null,
        total_pay: registration ? numberOrNull(registration.total_pay) : null,
        completed_at: completedAt,
        completed_at_source: registration?.confirmed_at
          ? "confirmed_at"
          : (receipt?.issued_at ? "issued_at" : null),
        table_number: receipt ? numberOrNull(receipt.table_number) : null,
        seat_number: receipt ? numberOrNull(receipt.seat_number) : null,
        starting_stack: numberOrNull(tournament.starting_stack),
      },
    });
  } catch (error) {
    console.error(
      "get-buyin-receipt failed",
      error instanceof Error ? error.message : error,
    );
    return jsonResp(req, { error: "RECEIPT_LOOKUP_FAILED" }, 500);
  }
});
