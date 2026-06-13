// TD AI assistant — advisory rules lookup for floor/TD staff.
// Auth (real user) → role gate (staff/club-admin) → zod validate → retrieval
// over the committed rules-index.json → below-threshold short-circuit (NO model
// call) → Lovable/Gemini via callModel → deterministic no-hallucination
// validator → TdAnswer. Never an official ruling; cites only retrieved rules.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";
import { callModel, type ModelRule } from "./callModel.ts";
import { retrieve, validateAnswer, type TdRule } from "./logic.ts";
import rulesIndex from "./rules-index.json" with { type: "json" };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RULES = (rulesIndex as { version: string; rules: TdRule[] }).rules;
const RULES_VERSION = (rulesIndex as { version: string }).version;

const BodySchema = z.object({
  tournamentId: z.string().uuid().optional(),
  tableLabel: z.string().max(120).optional(),
  street: z.enum(["preflop", "flop", "turn", "river", "showdown", "other"]).optional(),
  playersInvolved: z.string().max(500).optional(),
  actionSequence: z.string().max(2000).optional(),
  description: z.string().min(3).max(4000),
  houseRuleNote: z.string().max(2000).optional(),
});

const STAFF_ROLES = new Set(["super_admin", "cashier", "club_cashier", "club_admin"]);

// Best-effort, per-warm-instance (edge fns are stateless across cold starts).
const RATE: Map<string, number[]> = new Map();
const CACHE: Map<string, { answer: unknown; at: number }> = new Map();
const RATE_WINDOW_MS = 60_000, RATE_MAX = 10, CACHE_TTL_MS = 3_600_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function situationText(s: z.infer<typeof BodySchema>): string {
  return [
    s.tableLabel && `Bàn: ${s.tableLabel}`,
    s.street && `Vòng: ${s.street}`,
    s.playersInvolved && `Người liên quan: ${s.playersInvolved}`,
    s.actionSequence && `Trình tự: ${s.actionSequence}`,
    `Mô tả: ${s.description}`,
    s.houseRuleNote && `Ghi chú luật CLB: ${s.houseRuleNote}`,
  ].filter(Boolean).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const supaUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader }, fetch: retryFetch } },
    );
    const { data: userData, error: claimsErr } = await supaUser.auth.getUser(token);
    if (claimsErr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);
    const callerId = userData.user.id;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", callerId);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (![...roleSet].some((r) => STAFF_ROLES.has(r))) return json({ error: "Forbidden" }, 403);

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const situation = parsed.data;

    // Soft per-user rate limit.
    const now = Date.now();
    const recent = (RATE.get(callerId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX) return json({ error: "rate_limited" }, 429);
    recent.push(now); RATE.set(callerId, recent);

    const cacheKey = situationText(situation).toLowerCase().replace(/\s+/g, " ").trim();
    const cached = CACHE.get(cacheKey);
    if (cached && now - cached.at < CACHE_TTL_MS) {
      return json({ ...(cached.answer as object), cached: true, rules_version: RULES_VERSION });
    }

    const { hits, belowThreshold } = retrieve(situationText(situation), RULES);

    // Below threshold → no model call, return the no-basis template.
    if (belowThreshold) {
      const needMore = [
        !situation.street && "Sự việc xảy ra ở vòng nào?",
        !situation.playersInvolved && "Những ai liên quan?",
        !situation.actionSequence && "Trình tự hành động cụ thể?",
      ].filter(Boolean) as string[];
      const answer = validateAnswer({ needMoreInfoVi: needMore }, []);
      return json({ ...answer, rules_version: RULES_VERSION });
    }

    const retrieved = hits.map((h) => h.rule);
    const modelRules: ModelRule[] = retrieved.map((r) => ({
      id: r.id, topicVi: r.topicVi, summaryVi: r.summaryVi, citationLabel: r.citationLabel,
    }));

    const result = await callModel(situationText(situation), modelRules);
    if (!result.ok) return json({ error: result.error }, result.status);

    const answer = validateAnswer(result.answer, retrieved);
    CACHE.set(cacheKey, { answer, at: now });
    return json({ ...answer, rules_version: RULES_VERSION });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
