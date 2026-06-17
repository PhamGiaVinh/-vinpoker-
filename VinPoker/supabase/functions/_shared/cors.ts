const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:4173",
];

export function getAllowedOrigin(req: Request): string {
  const origin = req.headers.get("Origin") ?? "";
  const configured = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // When an explicit allowlist IS configured, honor it (hardening). When it is NOT
  // configured (the default), REFLECT the caller's origin so the production web app
  // works from any deployed domain — these endpoints are authenticated by Bearer JWT
  // (the edge calls auth.getUser), so CORS is not the security boundary here. The old
  // behaviour fell back to localhost:5173, which silently blocked every browser
  // `functions.invoke` from production (CORS), breaking sit/create/claim.
  if (configured.length > 0) {
    const allowed = [...DEV_ORIGINS, ...configured];
    return allowed.includes(origin) ? origin : (allowed[0] ?? "*");
  }
  return origin || "*";
}

export function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getAllowedOrigin(req),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  return null;
}

export function jsonResp(
  req: Request,
  data: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}