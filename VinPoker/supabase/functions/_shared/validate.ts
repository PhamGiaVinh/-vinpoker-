// Shared input validation helper for Edge Functions.
// Validates JSON request bodies with Zod schemas before any DB work.
//
// Usage:
//   const Body = z.object({ deal_id: z.string().uuid() });
//   const parsed = await parseBody(req, Body, corsHeaders);
//   if (!parsed.ok) return parsed.response;
//   const { deal_id } = parsed.data;

import { z } from "npm:zod@3.25.76";

export { z };

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

export async function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
  corsHeaders: Record<string, string> = {},
): Promise<ParseResult<z.infer<T>>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: jsonError(400, "Invalid JSON body", undefined, corsHeaders),
    };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: jsonError(
        400,
        "Invalid input",
        result.error.flatten().fieldErrors,
        corsHeaders,
      ),
    };
  }
  return { ok: true, data: result.data };
}

function jsonError(
  status: number,
  message: string,
  details?: unknown,
  corsHeaders: Record<string, string> = {},
): Response {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Common reusable schema fragments.
const Uuid = z.string().uuid();
const ShortText = z.string().trim().min(1).max(500);
const Reason = z.string().trim().max(1000).nullish();
const Note = z.string().trim().max(1000).nullish();
const Percent1to100 = z.number().int().min(1).max(100);
const NonNegInt = z.number().int().min(0);
const PositiveAmountVnd = z.number().min(0).max(1e10); // up to 10 tỷ VND
const HttpsUrl = z.string().url().max(2048);
