import { pathToFileURL } from "node:url";

const MONITOR = "process_swing_dark";
const HSOP_CLUB_ID = "22222222-2222-2222-2222-222222222222";
const WINDOW_MINUTES = 15;
const INTERVAL_MS = 60_000;
const MAX_ROWS = 500;
const ACTIVE_BUSINESS_STATES = new Set([null, "received", "started"]);
const TRANSPORT_STATES = new Set(["pending", "succeeded", "failed", "timed_out"]);
const BUSINESS_STATES = new Set(["received", "started", "completed", "partial", "locked", "dependency_unavailable", "business_failed"]);
const ALERT_CLASSIFICATIONS = new Set([
  "healthy",
  "temporary_wait",
  "reserved_relief_pending",
  "true_shortage",
  "critical_shortage",
  "snapshot_invalid",
]);
const ALERT_STATUSES = new Set(["open", "acknowledged", "resolved", "expired"]);

function safeCode(value, fallback = "UNKNOWN") {
  return typeof value === "string" && /^[A-Za-z0-9_]{1,96}$/.test(value) ? value : fallback;
}

function safeHttpStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function parseTime(value) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : null;
}

function countBy(values) {
  return Object.fromEntries([...values.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function addCount(map, value) {
  map.set(value, (map.get(value) ?? 0) + 1);
}

function publicRole(roleByClub, clubId) {
  return roleByClub.get(clubId) ?? null;
}

function failure(errorCode) {
  return {
    monitor: MONITOR,
    monitor_status: "failed",
    error_code: safeCode(errorCode, "MONITOR_FAILED"),
  };
}

export function selectMonitoredClubs(rows) {
  const clubIds = new Set();
  for (const row of rows) {
    if (typeof row?.club_id === "string" && /^[0-9a-f-]{36}$/i.test(row.club_id)) clubIds.add(row.club_id);
  }

  if (!clubIds.has(HSOP_CLUB_ID)) return { errorCode: "HSOP_NO_DISPATCH" };
  const controlClubId = [...clubIds].filter((clubId) => clubId !== HSOP_CLUB_ID).sort()[0];
  if (!controlClubId) return { errorCode: "CONTROL_CLUB_NO_DISPATCH" };

  return {
    roleByClub: new Map([
      [HSOP_CLUB_ID, "hsop"],
      [controlClubId, "control"],
    ]),
  };
}

function summarizeDispatchRows(rows, roleByClub, nowMs, requiredTicks) {
  const roles = new Map([
    ["hsop", { ticks: new Set(), transport: new Map(), business: new Map(), errors: new Map(), stalePending: 0, overlappingLeases: 0, unresolvedBusiness: 0, candidateBreakFailures: 0, timedOutCompleted: 0 }],
    ["control", { ticks: new Set(), transport: new Map(), business: new Map(), errors: new Map(), stalePending: 0, overlappingLeases: 0, unresolvedBusiness: 0, candidateBreakFailures: 0, timedOutCompleted: 0 }],
  ]);
  const activeLeaseCount = new Map([["hsop", 0], ["control", 0]]);

  for (const row of rows) {
    const role = publicRole(roleByClub, row?.club_id);
    if (!role) continue;
    const summary = roles.get(role);
    const transportState = TRANSPORT_STATES.has(row?.transport_state) ? row.transport_state : "unknown";
    const businessState = row?.business_state === null || BUSINESS_STATES.has(row?.business_state)
      ? row.business_state ?? "pending"
      : "unknown";
    const requestedAt = parseTime(row?.requested_at);
    const tickAt = parseTime(row?.tick_at);
    const leaseExpiresAt = parseTime(row?.lease_expires_at);
    const timeoutMs = Number.isInteger(row?.timeout_ms) ? row.timeout_ms : 0;

    if (requestedAt === null || tickAt === null || leaseExpiresAt === null || timeoutMs < 55_000 || timeoutMs > 300_000) {
      throw new Error("DISPATCH_ROW_INVALID");
    }

    summary.ticks.add(new Date(tickAt).toISOString());
    addCount(summary.transport, transportState);
    addCount(summary.business, businessState);
    const errorCode = row?.business_error_code === null ? null : safeCode(row?.business_error_code, "UNSAFE_ERROR_CODE");
    if (errorCode) addCount(summary.errors, errorCode);
    if (errorCode === "candidate_assignment_breaks_query_failed" || errorCode?.startsWith("candidate_attendance_breaks_")) {
      summary.candidateBreakFailures += 1;
    }
    if (transportState === "pending" && requestedAt + timeoutMs + 30_000 < nowMs) summary.stalePending += 1;
    if (ACTIVE_BUSINESS_STATES.has(row?.business_state) && leaseExpiresAt > nowMs) activeLeaseCount.set(role, activeLeaseCount.get(role) + 1);
    if (ACTIVE_BUSINESS_STATES.has(row?.business_state) && leaseExpiresAt <= nowMs) summary.unresolvedBusiness += 1;
    if (transportState === "timed_out" && businessState === "completed") summary.timedOutCompleted += 1;
  }

  const publicSummary = {};
  const failures = [];
  for (const [role, summary] of roles) {
    const active = activeLeaseCount.get(role) ?? 0;
    summary.overlappingLeases = Math.max(0, active - 1);
    publicSummary[role] = {
      dispatch_ticks: summary.ticks.size,
      transport_states: countBy(summary.transport),
      business_states: countBy(summary.business),
      business_error_codes: countBy(summary.errors),
      stale_pending: summary.stalePending,
      active_lease_overlap: summary.overlappingLeases,
      unresolved_business: summary.unresolvedBusiness,
      candidate_break_query_failures: summary.candidateBreakFailures,
      transport_timeout_then_completed: summary.timedOutCompleted,
    };
    if (summary.ticks.size < requiredTicks) failures.push(`${role.toUpperCase()}_INSUFFICIENT_TICKS`);
    if (summary.stalePending > 0) failures.push(`${role.toUpperCase()}_STALE_PENDING`);
    if (summary.overlappingLeases > 0) failures.push(`${role.toUpperCase()}_LEASE_OVERLAP`);
    if (summary.unresolvedBusiness > 0) failures.push(`${role.toUpperCase()}_UNRESOLVED_BUSINESS`);
    if (summary.candidateBreakFailures > 0) failures.push(`${role.toUpperCase()}_CANDIDATE_BREAK_QUERY_FAILURE`);
    if ((summary.business.get("business_failed") ?? 0) > 0 || (summary.business.get("dependency_unavailable") ?? 0) > 0) {
      failures.push(`${role.toUpperCase()}_BUSINESS_FAILURE`);
    }
  }

  return { publicSummary, failures };
}

function summarizeAlerts(rows, roleByClub, startMs) {
  const output = {
    hsop: { notifications: 0, false_notifications: 0, classifications: new Map(), statuses: new Map(), error_codes: new Map() },
    control: { notifications: 0, false_notifications: 0, classifications: new Map(), statuses: new Map(), error_codes: new Map() },
  };
  const failures = [];

  for (const row of rows) {
    const role = publicRole(roleByClub, row?.club_id);
    if (!role) continue;
    const summary = output[role];
    const classification = ALERT_CLASSIFICATIONS.has(row?.classification) ? row.classification : "unknown";
    const status = ALERT_STATUSES.has(row?.status) ? row.status : "unknown";
    const notifiedAt = row?.last_notified_at === null ? null : parseTime(row?.last_notified_at);
    const errorCode = row?.error_code === null ? null : safeCode(row?.error_code, "UNSAFE_ERROR_CODE");
    if (row?.last_notified_at !== null && notifiedAt === null) throw new Error("ALERT_ROW_INVALID");
    addCount(summary.classifications, classification);
    addCount(summary.statuses, status);
    if (errorCode) addCount(summary.error_codes, errorCode);
    if (notifiedAt !== null && notifiedAt >= startMs) {
      summary.notifications += 1;
      if (classification !== "true_shortage" && classification !== "critical_shortage") summary.false_notifications += 1;
    }
  }

  const publicSummary = {};
  for (const [role, summary] of Object.entries(output)) {
    publicSummary[role] = {
      notifications: summary.notifications,
      false_notifications: summary.false_notifications,
      classifications: countBy(summary.classifications),
      statuses: countBy(summary.statuses),
      error_codes: countBy(summary.error_codes),
    };
    if (summary.false_notifications > 0) failures.push(`${role.toUpperCase()}_FALSE_SHORTAGE_NOTIFICATION`);
  }
  return { publicSummary, failures };
}

export function summarizeMonitor({ dispatchRows, alertRows, roleByClub, startMs, nowMs, requiredTicks }) {
  const dispatch = summarizeDispatchRows(dispatchRows, roleByClub, nowMs, requiredTicks);
  const alerts = summarizeAlerts(alertRows, roleByClub, startMs);
  const failureCodes = [...new Set([...dispatch.failures, ...alerts.failures])].sort();
  return {
    monitor: MONITOR,
    duration_minutes: WINDOW_MINUTES,
    required_ticks_per_club: requiredTicks,
    monitor_status: failureCodes.length === 0 ? "pass" : "failed",
    failure_codes: failureCodes,
    dispatch: dispatch.publicSummary,
    alerts: alerts.publicSummary,
  };
}

function providerFailure(error, stage) {
  const code = safeCode(error?.code, "QUERY_FAILED");
  const status = safeHttpStatus(error?.status) ?? "none";
  return `${stage}_${code}_${status}`;
}

async function fetchDispatchRows(admin, startIso) {
  const response = await admin
    .from("process_swing_dispatch_runs")
    .select("club_id,tick_at,requested_at,timeout_ms,lease_expires_at,transport_state,business_state,business_error_code")
    .gte("requested_at", startIso)
    .order("requested_at", { ascending: true })
    .limit(MAX_ROWS);
  if (response?.error) throw new Error(providerFailure(response.error, "DISPATCH_QUERY"));
  if (!Array.isArray(response?.data) || response.data.length >= MAX_ROWS) throw new Error("DISPATCH_QUERY_LIMIT_OR_SHAPE");
  return response.data;
}

async function fetchAlertRows(admin, startIso) {
  const response = await admin
    .from("dealer_shortage_alert_incidents")
    .select("club_id,classification,status,last_notified_at,error_code,updated_at")
    .gte("updated_at", startIso)
    .order("updated_at", { ascending: true })
    .limit(MAX_ROWS);
  if (response?.error) throw new Error(providerFailure(response.error, "ALERT_QUERY"));
  if (!Array.isArray(response?.data) || response.data.length >= MAX_ROWS) throw new Error("ALERT_QUERY_LIMIT_OR_SHAPE");
  return response.data;
}

async function verifiedReceipt(fetchImpl, githubToken, expectedSha) {
  const deploymentsResponse = await fetchImpl(
    "https://api.github.com/repos/PhamGiaVinh/-vinpoker-/deployments?environment=receipt-vinpoker-edge-process-swing&per_page=20",
    { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${githubToken}`, "X-GitHub-Api-Version": "2022-11-28" } },
  );
  if (!deploymentsResponse.ok) throw new Error(`RECEIPT_DEPLOYMENTS_HTTP_${deploymentsResponse.status}`);
  const deployments = await deploymentsResponse.json();
  if (!Array.isArray(deployments)) throw new Error("RECEIPT_DEPLOYMENTS_SHAPE");
  for (const deployment of deployments) {
    const statusesResponse = await fetchImpl(
      `https://api.github.com/repos/PhamGiaVinh/-vinpoker-/deployments/${deployment.id}/statuses?per_page=20`,
      { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${githubToken}`, "X-GitHub-Api-Version": "2022-11-28" } },
    );
    if (!statusesResponse.ok) throw new Error(`RECEIPT_STATUS_HTTP_${statusesResponse.status}`);
    const statuses = await statusesResponse.json();
    if (Array.isArray(statuses) && statuses.some((status) => status?.state === "success")) {
      if (deployment?.sha !== expectedSha) throw new Error("RECEIPT_TARGET_MISMATCH");
      return;
    }
  }
  throw new Error("RECEIPT_SUCCESS_MISSING");
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runMonitor({ admin, githubToken, expectedSha, fetchImpl = fetch, now = () => Date.now(), wait = sleep }) {
  if (!/^[0-9a-f]{40}$/.test(expectedSha ?? "") || !githubToken) return failure("CREDENTIAL_OR_TARGET_INVALID");
  try {
    await verifiedReceipt(fetchImpl, githubToken, expectedSha);
    const startMs = now();
    const startIso = new Date(startMs).toISOString();
    const requiredTicks = WINDOW_MINUTES;
    let roleByClub = null;
    let dispatchRows = [];

    for (let sample = 0; sample <= WINDOW_MINUTES; sample += 1) {
      dispatchRows = await fetchDispatchRows(admin, startIso);
      if (!roleByClub) {
        const selected = selectMonitoredClubs(dispatchRows);
        if (selected.roleByClub) roleByClub = selected.roleByClub;
      }
      if (sample < WINDOW_MINUTES) await wait(INTERVAL_MS);
    }

    if (!roleByClub) return failure("MONITORED_CLUBS_UNAVAILABLE");
    const alertRows = await fetchAlertRows(admin, startIso);
    return summarizeMonitor({ dispatchRows, alertRows, roleByClub, startMs, nowMs: now(), requiredTicks });
  } catch (error) {
    return failure(safeCode(error?.message, "MONITOR_QUERY_FAILED"));
  }
}

async function main() {
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const githubToken = process.env.GITHUB_TOKEN;
  const expectedSha = process.env.EXPECTED_PROCESS_SWING_SHA;
  if (!/^[a-z0-9]{20}$/i.test(projectRef ?? "") || !serviceRoleKey || !githubToken) {
    console.log(JSON.stringify(failure("CREDENTIAL_UNAVAILABLE")));
    process.exitCode = 1;
    return;
  }
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(`https://${projectRef}.supabase.co`, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result = await runMonitor({ admin, githubToken, expectedSha });
  console.log(JSON.stringify(result));
  if (result.monitor_status !== "pass") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
