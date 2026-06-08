const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:4173",
];

export function getAllowedOrigin(req: Request): string {
  const configured = Deno.env.get("ALLOWED_ORIGINS") ?? "";
  const allowed = [
    ...DEV_ORIGINS,
    ...configured
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];
  const origin = req.headers.get("Origin") ?? "";
  return allowed.includes(origin) ? origin : allowed[0] ?? "*";
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