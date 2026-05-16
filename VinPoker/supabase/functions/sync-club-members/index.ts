// Sync club members CSV upload — upserts into club_members + writes sync_logs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { parseBody, z } from "../_shared/validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RowSchema = z.object({
  member_card_id: z.string().trim().min(1).max(64),
  full_name: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(20).nullish(),
  cccd: z.string().trim().max(20).nullish(),
});

const BodySchema = z.object({
  club_id: z.string().uuid(),
  source_type: z.enum(["csv", "api", "manual"]).default("csv"),
  rows: z.array(RowSchema).min(1).max(2000),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const supaUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims, error: claimsErr } = await supaUser.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const callerId = claims.claims.sub as string;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const { club_id, source_type, rows } = parsed.data;

    // Authorize: super_admin OR cashier of the club
    const { data: isSuperData } = await admin.rpc("has_role", { _user_id: callerId, _role: "super_admin" });
    const isSuper = !!isSuperData;
    if (!isSuper) {
      const { data: isCashier } = await admin.rpc("is_club_cashier", { _user_id: callerId, _club_id: club_id });
      if (!isCashier) return json({ error: "Forbidden — not cashier of this club" }, 403);
    }

    // Pre-check existing rows to count inserted vs updated
    const cardIds = Array.from(new Set(rows.map((r) => r.member_card_id)));
    const { data: existing } = await admin
      .from("club_members")
      .select("member_card_id")
      .eq("club_id", club_id)
      .in("member_card_id", cardIds);
    const existingSet = new Set((existing ?? []).map((r: any) => r.member_card_id));

    const payload = rows.map((r) => ({
      club_id,
      member_card_id: r.member_card_id,
      full_name: r.full_name ?? null,
      phone: r.phone ?? null,
      cccd: r.cccd ?? null,
      source: source_type,
      synced_at: new Date().toISOString(),
    }));

    const errors: { card: string; message: string }[] = [];
    let succeeded = 0;
    // Chunk to avoid statement size limits
    const CHUNK = 500;
    for (let i = 0; i < payload.length; i += CHUNK) {
      const slice = payload.slice(i, i + CHUNK);
      const { error } = await admin
        .from("club_members")
        .upsert(slice, { onConflict: "club_id,member_card_id", ignoreDuplicates: false });
      if (error) {
        errors.push({ card: `chunk@${i}`, message: error.message });
      } else {
        succeeded += slice.length;
      }
    }

    const inserted = payload.filter((r) => !existingSet.has(r.member_card_id)).length;
    const updated = succeeded - inserted < 0 ? 0 : succeeded - inserted;
    const failed = rows.length - succeeded;

    await admin.from("sync_logs").insert({
      club_id,
      synced_by: callerId,
      source_type,
      records_inserted: inserted,
      records_updated: updated,
      records_failed: failed,
      error_sample: errors.length ? errors.slice(0, 5) : null,
    });

    return json({ inserted, updated, failed, errors: errors.slice(0, 5) });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
