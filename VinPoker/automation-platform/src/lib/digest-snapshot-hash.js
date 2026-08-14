import { sha256 } from "./stable-json.js";

const METRIC_KEYS = [
  "registered_players",
  "attendance_players",
  "entries_count",
  "staff_count",
  "rake_paid_vnd",
  "service_fee_paid_vnd",
  "fnb_net_revenue_vnd",
  "payout_outstanding_vnd",
  "dealer_payroll_outstanding_vnd",
];

/** Cross-runtime hash vector mirrored by private.owner_daily_digest_content_hash_v2(jsonb). */
export function digestCanonicalSnapshotContentV2(payload) {
  const vector = [
    "OWNER_DAILY_DIGEST_V2",
    payload.business_date,
    payload.calculation_version,
    payload.effective_timezone,
    epochSeconds(payload.window_start_utc),
    epochSeconds(payload.window_end_utc),
    payload.freshness_state,
    payload.money_state,
  ];
  for (const key of METRIC_KEYS) {
    const metric = payload.metrics?.[key];
    vector.push(metric?.value === null ? "null" : String(metric?.value));
    vector.push(String(metric?.state));
  }
  vector.push((payload.warning_codes ?? []).join(","));
  vector.push((payload.action_codes ?? []).join(","));
  return sha256(vector.join("|"));
}

function epochSeconds(value) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("Canonical Digest timestamp is invalid");
  return String(Math.trunc(milliseconds / 1000));
}
