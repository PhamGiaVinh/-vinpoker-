import { readFile, writeFile } from "node:fs/promises";

const PRODUCTION_REF = "orlesggcjamwuknxwcpk";
const EXPECTED_HEAD_REF = "codex/floor-production-canary";
const FUNCTION_SLUG = "tournament-live-draw";

function fail(code) {
  throw new Error(code);
}

function safeHash(value) {
  return typeof value === "string" && /^[a-f0-9]{16,128}$/i.test(value)
    ? value
    : "unavailable";
}

function requireContext(environment = process.env) {
  for (const name of [
    "SUPABASE_PROJECT_REF",
    "SUPABASE_ACCESS_TOKEN",
    "GITHUB_REF",
    "GITHUB_HEAD_REF",
    "FLOOR_EDGE_PHASE",
    "FLOOR_EDGE_STATE_FILE",
  ]) {
    if (!environment[name]) fail(`missing_context_${name}`);
  }
  if (environment.SUPABASE_PROJECT_REF !== PRODUCTION_REF) {
    fail("project_ref_mismatch");
  }
  if (environment.GITHUB_REF === "refs/heads/main") {
    fail("edge_rollout_must_not_run_from_main");
  }
  if (environment.GITHUB_HEAD_REF !== EXPECTED_HEAD_REF) {
    fail("head_ref_mismatch");
  }
  if (!["pre", "post", "rollback-post"].includes(environment.FLOOR_EDGE_PHASE)) {
    fail("edge_phase_invalid");
  }
  return {
    accessToken: environment.SUPABASE_ACCESS_TOKEN,
    projectRef: environment.SUPABASE_PROJECT_REF,
    phase: environment.FLOOR_EDGE_PHASE,
    stateFile: environment.FLOOR_EDGE_STATE_FILE,
  };
}

async function metadata(context) {
  let response;
  try {
    response = await fetch(
      `https://api.supabase.com/v1/projects/${context.projectRef}/functions/${FUNCTION_SLUG}`,
      { headers: { Authorization: `Bearer ${context.accessToken}` } },
    );
  } catch {
    fail("edge_metadata_network_error");
  }
  if (!response.ok) fail(`edge_metadata_status_${response.status}`);
  const payload = await response.json();
  const version = Number(payload?.version);
  if (
    payload?.slug !== FUNCTION_SLUG || payload?.status !== "ACTIVE" ||
    !Number.isInteger(version) || version < 1
  ) {
    fail("edge_metadata_invalid");
  }
  if (payload?.verify_jwt !== false) fail("edge_verify_jwt_posture_changed");
  return {
    slug: FUNCTION_SLUG,
    version,
    status: "ACTIVE",
    verifyJwt: false,
    bundleHash: safeHash(payload?.ezbr_sha256),
    updatedAt: typeof payload?.updated_at === "number" ||
        typeof payload?.updated_at === "string"
      ? String(payload.updated_at)
      : "unavailable",
  };
}

async function main() {
  const context = requireContext();
  const current = await metadata(context);
  if (context.phase === "pre") {
    await writeFile(context.stateFile, JSON.stringify({ pre: current }), {
      encoding: "utf8",
      mode: 0o600,
    });
    console.log(
      `FLOOR_CHIP_CAS_EDGE PRE version=${current.version} status=ACTIVE verify_jwt=false bundle_hash=${current.bundleHash} updated_at=${current.updatedAt}`,
    );
    return;
  }

  let state;
  try {
    state = JSON.parse(await readFile(context.stateFile, "utf8"));
  } catch {
    fail("edge_pre_state_unreadable");
  }
  const baseline = context.phase === "post" ? state?.pre : state?.deployed ?? state?.pre;
  if (!Number.isInteger(baseline?.version)) fail("edge_pre_state_invalid");
  if (current.version <= baseline.version) fail("edge_version_not_incremented");
  const label = context.phase === "post" ? "POST" : "ROLLBACK_POST";
  console.log(
    `FLOOR_CHIP_CAS_EDGE ${label} previous_version=${baseline.version} version=${current.version} status=ACTIVE verify_jwt=false bundle_hash=${current.bundleHash} updated_at=${current.updatedAt}`,
  );
  if (context.phase === "post") {
    await writeFile(
      context.stateFile,
      JSON.stringify({ pre: state.pre, deployed: current }),
      { encoding: "utf8", mode: 0o600 },
    );
  }
}

export { requireContext };

main().catch((error) => {
  console.error(
    `FLOOR_CHIP_CAS_EDGE FAIL ${error instanceof Error ? error.message : "unknown"}`,
  );
  process.exitCode = 1;
});
