import { createClient } from "npm:@supabase/supabase-js@2.105.4";

import { corsHeaders, handleOptions, jsonResp } from "../_shared/cors.ts";
import { retryFetch } from "../_shared/retry.ts";
import {
  buildTrackerVoiceRealtimeSession,
  normalizeTrackerVoiceCredential,
  TRACKER_VOICE_DEFAULT_MODEL,
} from "./protocol.ts";

const MAX_REQUEST_BYTES = 4_096;

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function safetyIdentifier(actorId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(actorId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return jsonResp(req, { error: "METHOD_NOT_ALLOWED" }, 405);

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return jsonResp(req, { error: "REQUEST_TOO_LARGE" }, 413);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !openAiKey) {
    return jsonResp(req, { error: "VOICE_SESSION_MISCONFIGURED" }, 503);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResp(req, { error: "UNAUTHORIZED" }, 401);
  }

  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return jsonResp(req, { error: "REQUEST_TOO_LARGE" }, 413);
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return jsonResp(req, { error: "INVALID_JSON" }, 400);
    }
    const tournamentId = body.tournament_id;
    const tournamentTableId = body.tournament_table_id;
    if (!isUuid(tournamentId) || !isUuid(tournamentTableId)) {
      return jsonResp(req, { error: "INVALID_SCOPE" }, 400);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader }, fetch: retryFetch },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    const actorId = userData?.user?.id;
    if (userError || !actorId) return jsonResp(req, { error: "UNAUTHORIZED" }, 401);

    const { data: runtimeData, error: runtimeError } = await userClient.rpc(
      "get_tracker_voice_runtime_context",
      {
        p_tournament_id: tournamentId,
        p_tournament_table_id: tournamentTableId,
      },
    );
    const runtime = runtimeData as Record<string, unknown> | null;
    if (runtimeError || runtime?.ok !== true || runtime.can_mint_session !== true) {
      return jsonResp(req, {
        error: typeof runtime?.error === "string" ? runtime.error : "VOICE_SESSION_DENIED",
      }, 403);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      global: { fetch: retryFetch },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: rateData, error: rateError } = await admin.rpc(
      "_tracker_voice_consume_session_rate_limit",
      {
        p_actor_user_id: actorId,
        p_tournament_id: tournamentId,
        p_tournament_table_id: tournamentTableId,
      },
    );
    const rate = rateData as Record<string, unknown> | null;
    if (rateError) return jsonResp(req, { error: "VOICE_RATE_LIMIT_UNAVAILABLE" }, 503);
    if (rate?.ok !== true) {
      const status = rate?.error === "voice_session_rate_limited" ? 429 : 403;
      return jsonResp(req, {
        error: typeof rate?.error === "string" ? rate.error : "VOICE_SESSION_DENIED",
        ...(typeof rate?.retry_after_seconds === "number"
          ? { retry_after_seconds: rate.retry_after_seconds }
          : {}),
      }, status);
    }

    const config = runtime.config && typeof runtime.config === "object"
      ? runtime.config as Record<string, unknown>
      : {};
    const model = typeof config.provider_model === "string" && config.provider_model.trim()
      ? config.provider_model
      : TRACKER_VOICE_DEFAULT_MODEL;
    const providerResponse = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": await safetyIdentifier(actorId),
      },
      body: JSON.stringify(buildTrackerVoiceRealtimeSession(model)),
    });
    if (!providerResponse.ok) {
      return jsonResp(req, { error: "OPENAI_SESSION_FAILED" }, 502);
    }
    const credential = normalizeTrackerVoiceCredential(await providerResponse.json(), model);
    if (!credential) return jsonResp(req, { error: "OPENAI_SESSION_MALFORMED" }, 502);
    return jsonResp(req, credential);
  } catch {
    return jsonResp(req, { error: "VOICE_SESSION_FAILED" }, 500);
  }
});
