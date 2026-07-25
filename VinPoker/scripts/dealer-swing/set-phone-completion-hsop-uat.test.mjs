import assert from "node:assert/strict";
import test from "node:test";

import {
  DISABLE_CONFIRMATION,
  ENABLE_CONFIRMATION,
  HSOP_CLUB_ID,
  run,
} from "./set-phone-completion-hsop-uat.mjs";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function schemaState() {
  return {
    rollout_table_exists: true, checkin_requests_table_exists: true, close_requests_table_exists: true,
    rollout_rls_enabled: true, checkin_requests_rls_enabled: true, close_requests_rls_enabled: true,
    get_rollout_exists: true, checkin_exists: true, close_state_exists: true, legacy_close_exists: true,
    guarded_close_exists: true, canonical_reconcile_exists: true, phone_reconcile_exists: true,
    record_checkin_exists: true, pool_enabled_exists: true, pool_bridge_exists: true, pool_config_enabled: true,
    pool_bridge_job_exists: true, get_rollout_overloads: 1, checkin_overloads: 1, close_overloads: 2,
    phone_reconcile_overloads: 1, get_rollout_authenticated_execute: true, get_rollout_anon_execute: false,
    checkin_authenticated_execute: true, checkin_anon_execute: false, guarded_close_authenticated_execute: true,
    guarded_close_anon_execute: false, phone_reconcile_authenticated_execute: true, phone_reconcile_anon_execute: false,
    get_rollout_security_definer: true, checkin_security_definer: true, guarded_close_security_definer: true,
    phone_reconcile_security_definer: true,
    rollout: { master_disabled: true, all_clubs_disabled: true, allowlist_empty: true },
  };
}

test("runtime gate enables only HSOP and disables only the exact HSOP state", async () => {
  const calls = [];
  let state = { enabled: false, all_clubs_enabled: false, allowlist_count: 0, hsop_only: false };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/database/migrations") && options.method === "GET") {
      return jsonResponse([
        { version: "1", name: "20270102000000_operator_dealer_checkin" },
        { version: "2", name: "20270102000001_close_dealer_tables_cas" },
      ]);
    }
    if (url.endsWith("/database/query/read-only")) {
      const query = JSON.parse(options.body).query;
      if (query.includes("NOT enabled AS master_disabled")) {
        return jsonResponse([{ master_disabled: !state.enabled, all_clubs_disabled: !state.all_clubs_enabled, allowlist_empty: state.allowlist_count === 0 }]);
      }
      if (query.includes("FROM public.dealer_swing_phone_rollout")) return jsonResponse([state]);
      return jsonResponse([schemaState()]);
    }
    if (url.endsWith("/database/query") && options.method === "POST") {
      const query = JSON.parse(options.body).query;
      assert.match(query, new RegExp(HSOP_CLUB_ID));
      if (query.includes("SET enabled = true")) state = { enabled: true, all_clubs_enabled: false, allowlist_count: 1, hsop_only: true };
      else state = { enabled: false, all_clubs_enabled: false, allowlist_count: 0, hsop_only: false };
      return jsonResponse([{ applied: true }]);
    }
    throw new Error(`unexpected request ${options.method} ${url}`);
  };
  const env = { SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk", SUPABASE_ACCESS_TOKEN: "test-token" };

  const enabled = await run(["--enable-hsop"], { ...env, CONFIRM_DEALER_SWING_PHONE_HSOP: ENABLE_CONFIRMATION }, fetchImpl);
  assert.equal(enabled.applied, true);
  assert.deepEqual(enabled.state, { enabled: true, all_clubs_enabled: false, allowlist_count: 1, hsop_only: true });

  const disabled = await run(["--disable-hsop"], { ...env, CONFIRM_DEALER_SWING_PHONE_HSOP: DISABLE_CONFIRMATION }, fetchImpl);
  assert.equal(disabled.applied, true);
  assert.deepEqual(disabled.state, { enabled: false, all_clubs_enabled: false, allowlist_count: 0, hsop_only: false });

  const writes = calls.filter((call) => call.url.endsWith("/database/query") && call.options.method === "POST");
  assert.equal(writes.length, 2);
});

test("refuses broad or unknown runtime state before writing", async () => {
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/database/migrations") && options.method === "GET") {
      return jsonResponse([
        { version: "1", name: "20270102000000_operator_dealer_checkin" },
        { version: "2", name: "20270102000001_close_dealer_tables_cas" },
      ]);
    }
    if (url.endsWith("/database/query/read-only")) {
      const query = JSON.parse(options.body).query;
      if (query.includes("NOT enabled AS master_disabled")) {
        return jsonResponse([{ master_disabled: true, all_clubs_disabled: true, allowlist_empty: true }]);
      }
      if (query.includes("FROM public.dealer_swing_phone_rollout")) {
        return jsonResponse([{ enabled: true, all_clubs_enabled: true, allowlist_count: 3, hsop_only: false }]);
      }
      return jsonResponse([schemaState()]);
    }
    throw new Error("write must not be attempted");
  };
  await assert.rejects(
    run(["--disable-hsop"], {
      SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk",
      SUPABASE_ACCESS_TOKEN: "test-token",
      CONFIRM_DEALER_SWING_PHONE_HSOP: DISABLE_CONFIRMATION,
    }, fetchImpl),
    /refusing_to_change_broad_or_unknown_scope/,
  );
});
