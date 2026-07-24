const PROBE = "dealer_breaks_assignment_relation";

function validStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function providerCode(error) {
  const code = typeof error?.code === "string" ? error.code.toUpperCase() : "";
  return /^[A-Z0-9_]{1,32}$/.test(code) ? code : "QUERY_FAILED";
}

function failed(status, code) {
  return {
    probe: PROBE,
    status: validStatus(status),
    provider_code: code,
    relation_ready: false,
  };
}

/**
 * This executes no business operation. `limit(0)` verifies that PostgREST can
 * resolve the embed while ensuring the response contains no database rows.
 */
export async function probeCandidateBreakRelation({ admin }) {
  try {
    const response = await admin
      .from("dealer_breaks")
      .select("assignment_id, break_start, dealer_assignments!inner(attendance_id)")
      .is("break_end", null)
      .is("attendance_id", null)
      .limit(0);

    const status = validStatus(response?.status);
    if (response?.error !== null) {
      return failed(status, providerCode(response?.error));
    }
    if (!Array.isArray(response?.data) || response.data.length !== 0) {
      return failed(status, "UNEXPECTED_ROWS");
    }
    if (status !== 200 && status !== 206) {
      return failed(status, "UNEXPECTED_STATUS");
    }

    return {
      probe: PROBE,
      status,
      provider_code: null,
      relation_ready: true,
      rows_returned: 0,
    };
  } catch {
    return failed(null, "TRANSPORT_FAILED");
  }
}

async function run() {
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!/^[a-z0-9]{20}$/i.test(projectRef ?? "") || !serviceRoleKey) {
    console.log(JSON.stringify(failed(null, "CREDENTIAL_UNAVAILABLE")));
    process.exitCode = 1;
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(`https://${projectRef}.supabase.co`, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result = await probeCandidateBreakRelation({ admin });
  console.log(JSON.stringify(result));
  if (!result.relation_ready) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  run();
}
