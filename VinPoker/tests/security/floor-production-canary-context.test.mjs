import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  chipCasBrowserRequestBlockReason,
  createRunId,
  deleteExactAuthUsersBestEffort,
  discoverCleanupScope,
  expectedBlockedBrowserRequestReason,
  payoutBrowserRequestBlockReason,
  recoverAttemptedAuthUserIds,
  requireProductionCanaryContext,
} from "../../scripts/floor/floor-production-canary.mjs";

const canarySource = readFileSync(new URL("../../scripts/floor/floor-production-canary.mjs", import.meta.url), "utf8");

const valid = {
  FLOOR_CANARY_ENV: "production",
  FLOOR_CANARY_CONFIRM: "RUN_FLOOR_PRODUCTION_CANARY",
  FLOOR_CANARY_PREFIX: "CODEX_FLOOR_CANARY_",
  FLOOR_CANARY_MODE: "run",
  FLOOR_CANARY_BROWSER_ACTIONS_READY: "true",
  SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk",
  SUPABASE_URL: "https://orlesggcjamwuknxwcpk.supabase.co",
  SUPABASE_ANON_KEY: "test-anon",
  SUPABASE_SERVICE_ROLE_KEY: "test-service",
  GITHUB_REF: "refs/heads/codex/floor-production-canary",
};

test("accepts only an explicit non-main production canary context", () => {
  assert.equal(requireProductionCanaryContext(valid).projectRef, valid.SUPABASE_PROJECT_REF);
  assert.match(createRunId(valid.FLOOR_CANARY_PREFIX), /^CODEX_FLOOR_CANARY_\d{14}_[a-f0-9]{8}$/);
});

test("fails closed for main, wrong project, or an unsafe fixture prefix", () => {
  for (const [field, value, expected] of [
    ["GITHUB_REF", "refs/heads/main", "floor_canary_must_not_run_from_main"],
    ["SUPABASE_PROJECT_REF", "not-production", "production_project_ref_mismatch"],
    ["FLOOR_CANARY_PREFIX", "fixture_", "floor_canary_prefix_invalid"],
  ]) {
    assert.throws(() => requireProductionCanaryContext({ ...valid, [field]: value }), new RegExp(expected));
  }
});

test("fails closed for an unknown canary mode", () => {
  assert.throws(
    () => requireProductionCanaryContext({ ...valid, FLOOR_CANARY_MODE: "provision" }),
    /floor_canary_mode_invalid/,
  );
});

test("run mode fails closed until the full browser action matrix is reviewed", () => {
  assert.throws(
    () => requireProductionCanaryContext({ ...valid, FLOOR_CANARY_BROWSER_ACTIONS_READY: "false" }),
    /browser_action_matrix_not_ready/,
  );
  assert.doesNotThrow(() => requireProductionCanaryContext({
    ...valid,
    FLOOR_CANARY_MODE: "cleanup",
    FLOOR_CANARY_BROWSER_ACTIONS_READY: "false",
  }));
});

test("cleanup mode branches before provisioning or browser execution", () => {
  const cleanupBranch = canarySource.indexOf('if (context.mode === "cleanup")');
  assert.notEqual(cleanupBranch, -1);
  const cleanupBody = canarySource.slice(cleanupBranch, canarySource.indexOf("const runId", cleanupBranch));
  assert.match(cleanupBody, /await runCleanupCanary\(admin\)/);
  assert.doesNotMatch(cleanupBody, /createUser|createActor|createFixture|createCrossClub|runApiCanary|runBrowserManifest|invokeFunction|chromium/);
});

function cleanupDiscoveryAdmin(rows) {
  return {
    from(table) {
      assert.equal(table, "clubs");
      return {
        select() { return this; },
        like() { return this; },
        limit() { return Promise.resolve({ data: rows, error: null }); },
      };
    },
  };
}

const cleanupRows = [
  { id: "10000000-0000-4000-8000-000000000001", owner_id: "20000000-0000-4000-8000-000000000001", name: "CODEX_FLOOR_CANARY_20990101120000_aaaaaaaa_ACCESS", region: "TEST" },
  { id: "10000000-0000-4000-8000-000000000002", owner_id: "20000000-0000-4000-8000-000000000002", name: "CODEX_FLOOR_CANARY_20990101120000_aaaaaaaa_CROSS_CLUB", region: "TEST" },
];

test("cleanup discovery accepts exactly one strict failed run group with two TEST clubs", async () => {
  const scopes = await discoverCleanupScope(cleanupDiscoveryAdmin(cleanupRows));
  assert.equal(scopes.length, 1);
  assert.deepEqual(scopes.map((scope) => scope.clubs.length), [2]);
  const deletedActorScopes = await discoverCleanupScope(cleanupDiscoveryAdmin(cleanupRows.map((row) => ({ ...row, owner_id: null }))));
  assert.equal(deletedActorScopes.length, 1);
});

test("cleanup discovery rejects unexpected run counts, suffixes, regions, and club counts", async () => {
  for (const rows of [
    [],
    [...cleanupRows, { id: "10000000-0000-4000-8000-000000000003", owner_id: "20000000-0000-4000-8000-000000000003", name: "CODEX_FLOOR_CANARY_20990101140000_cccccccc_ACCESS", region: "TEST" }],
    cleanupRows.map((row, index) => index === 0 ? { ...row, region: "VN" } : row),
    cleanupRows.map((row, index) => index === 0 ? { ...row, name: `${row.name}_UNKNOWN` } : row),
    cleanupRows.slice(0, 1),
  ]) {
    await assert.rejects(discoverCleanupScope(cleanupDiscoveryAdmin(rows)), /CLEANUP_SCOPE_UNEXPECTED/);
  }
});

test("cleanup implementation remains exact-ID only and bounded", () => {
  assert.match(canarySource, /CLEANUP_GAME_TABLE_BATCH_SIZE = 50/);
  assert.match(canarySource, /CLEANUP_MAX_BATCH_ATTEMPTS = 3/);
  assert.match(canarySource, /nextAttempt === CLEANUP_MAX_BATCH_ATTEMPTS[\s\S]{0,80}\? 1/);
  assert.match(canarySource, /deleteExactBatches\(admin, "game_tables", ledger\.gameTableIds/);
  assert.match(canarySource, /async function deleteExactAuthUser[\s\S]{0,300}attempt <= 3/);
  assert.match(canarySource, /cleanup_tournaments[\s\S]{0,500}cleanup_generated_audit/);
  assert.match(canarySource, /cleanup_scope_audit_logs[\s\S]{0,250}cleanup_audit_logs/);
  assert.match(canarySource, /table: "dealer_rotation_schedule"[\s\S]{0,180}indexed: true/);
  assert.match(canarySource, /auth\.admin\.getUserById\(id\)/);
  assert.doesNotMatch(canarySource, /auth\.admin\.listUsers/);
  assert.match(canarySource, /owned\.actorAttempts\.push\(attempt\)/);
  assert.match(canarySource, /recoverAttemptedAuthUserIds[\s\S]{0,1400}signInWithPassword/);
  assert.match(canarySource, /scrubActorAttempts\(owned\)/);
  assert.match(canarySource, /owned\.clubAttempts\.push\(clubAttempt\)[\s\S]{0,100}owned\.clubs\.push\(clubId\)/);
  assert.doesNotMatch(canarySource, /delete\(\)[\s\S]{0,120}\.like\(/);
  assert.doesNotMatch(canarySource, /truncate|session_replication_role|schema_migrations/i);
  assert.match(canarySource, /referenced_by=\$\{referencedTable\}/);
});

test("scenario fixtures share one owned TEST club and finally uses an exact reconstructed ledger", () => {
  const fixtureBody = canarySource.slice(
    canarySource.indexOf("async function createFixture"),
    canarySource.indexOf("async function createCrossClub"),
  );
  assert.doesNotMatch(fixtureBody, /from\("clubs"\)\.insert/);
  assert.match(canarySource, /const primaryClubId = await createPrimaryClub/);
  assert.match(canarySource, /createFixture\(admin, runId, scenario, primaryClubId, owned\)/);
  assert.match(canarySource, /const tableName = `\$\{runId\}_\$\{scenario\}_T1`/);
  assert.equal((canarySource.match(/table_name: tableName/g) ?? []).length, 2);
  assert.match(canarySource, /await buildCleanupLedger\(admin, \{ runId, clubs \}, userIds\)/);
  assert.match(canarySource, /finally \{[\s\S]{0,200}await cleanupCurrentRun\(admin, context\.anonKey, context\.url, runId, owned\)/);
  assert.match(canarySource, /edge_draw_chip_cas_owner_write/);
  assert.match(canarySource, /async function updateSeatChip[\s\S]{0,900}safeEdgeResultDetail\(response\)/);
  assert.match(canarySource, /return `status=\$\{response\.status\} error_hash=\$\{errorHash\}`/);
});

test("full API matrix uses every isolated scenario and re-queries DB invariants", () => {
  for (const helper of [
    "runTableLifecycle",
    "runCloseTableInvariant",
    "runRedrawInvariant",
    "runBustRestoreInvariant",
    "preparePayoutCloseInvariant",
    "verifyPayoutCloseAfterBrowser",
  ]) {
    assert.match(canarySource, new RegExp(`async function ${helper}`));
    assert.match(canarySource, new RegExp(`await ${helper}\\(`));
  }
  assert.match(canarySource, /edge_clock_db_invariant/);
  assert.match(canarySource, /edge_draw_chip_cas_db_invariant/);
  assert.match(canarySource, /redraw_preview_zero_write/);
  assert.match(canarySource, /canonicalSeatGraph\(before\.rows\) === canonicalSeatGraph\(afterPreview\.rows\)/);
  assert.match(canarySource, /TABLE_LIFECYCLE: 21[\s\S]{0,120}CLOSE_ORPHAN: 31[\s\S]{0,120}REDRAW: 41/);
  assert.match(canarySource, /close_orphan_no_bust_invariant/);
  assert.match(canarySource, /bust_restore_no_payout_side_effect/);
  assert.match(canarySource, /payout_close_no_official_payment/);
  assert.doesNotMatch(canarySource, /mode:\s*"official"/);
});

test("payout preview/template and close report cleanup remain exact-owned", () => {
  assert.match(canarySource, /templateName = `\$\{fixture\.runId\}_PAYOUT_BROWSER_TEMPLATE`/);
  assert.match(canarySource, /payoutTemplates\.data\.some[\s\S]{0,260}!row\.name\.startsWith\(`\$\{scope\.runId\}_`\)/);
  assert.match(canarySource, /ledger\.childRows\.payout_templates = payoutTemplates\.data\.map/);
  assert.match(canarySource, /table: "tournament_close_report"[\s\S]{0,140}source: "tournamentIds"/);
  assert.match(canarySource, /moneySafetyPreflight\(admin, ledger, true\)/);
  assert.match(canarySource, /archetype: "DAILY"/);
  assert.doesNotMatch(canarySource, /from\("payout_templates"\)\.insert\([\s\S]{0,300}custom_percents/);
  assert.match(canarySource, /return "unexpected_mutation"/);
  assert.match(canarySource, /url\.origin !== baseOrigin && url\.origin !== supabaseOrigin/);
  assert.doesNotMatch(canarySource, /tournament_prize_payments"\)\.insert/);
});

test("browser payout is preview-only and closes only after exact owned UI confirmation", () => {
  const prepare = canarySource.indexOf("await preparePayoutCloseInvariant");
  const browser = canarySource.indexOf("await runBrowserManifest", prepare);
  const verify = canarySource.indexOf("await verifyPayoutCloseAfterBrowser", browser);
  assert.ok(prepare >= 0 && browser > prepare && verify > browser);
  assert.match(canarySource, /payoutBrowserRequestBlockReason/);
  assert.match(canarySource, /isExactPayoutPreviewBody\(body, policy\.fixture\.tournamentId\)/);
  assert.match(canarySource, /browser_payout_official_excluded/);
  assert.match(canarySource, /browser_close_report_confirm_clicked/);
  assert.match(canarySource, /registration_closed_at === null/);
  assert.doesNotMatch(canarySource, /mode:\s*"official"/);
  assert.match(canarySource, /fail\("browser_audit_required_for_run_mode"\)/);
});

test("browser payout egress policy blocks every external origin and unknown mutation", () => {
  const fixture = {
    tournamentId: "10000000-0000-4000-8000-000000000001",
    clubId: "20000000-0000-4000-8000-000000000001",
  };
  const policy = {
    baseUrl: "https://vinpoker.vercel.app",
    fixture,
    templateName: "CODEX_FLOOR_CANARY_20990101120000_aaaaaaaa_PAYOUT_BROWSER_TEMPLATE",
    ownerId: "30000000-0000-4000-8000-000000000001",
  };
  const request = (url, method, body = null) => ({ url, method, body });
  assert.equal(payoutBrowserRequestBlockReason(request("https://payments.example.test/collect", "POST", {}), policy), "external_origin");
  assert.equal(payoutBrowserRequestBlockReason(request("https://fonts.example.test/font.woff2", "GET"), policy), "external_origin");
  assert.equal(payoutBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/tournament_prize_payments",
    "POST",
    { tournament_id: fixture.tournamentId },
  ), policy), "unexpected_mutation");
  assert.equal(payoutBrowserRequestBlockReason(request(
    `https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/tournaments?id=eq.wrong`,
    "PATCH",
    {
      planned_itm_percent: 0.5,
      planned_payout_archetype: "DAILY",
      planned_min_cash_x: 1,
      planned_rounding_unit: 1,
    },
  ), policy), "unexpected_mutation");
  assert.equal(payoutBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/compute-payouts",
    "POST",
    {
      mode: "preview",
      tournament_id: fixture.tournamentId,
      archetype: "DAILY",
      min_cash_x: 1,
      rounding_unit: 1,
      entries_override: 2,
      itm_percent: 0.5,
    },
  ), policy), null);
  assert.equal(payoutBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/compute-payouts",
    "POST",
    {
      mode: "preview",
      tournament_id: fixture.tournamentId,
      archetype: "DAILY",
      min_cash_x: 1,
      rounding_unit: 1,
      entries_override: 2,
      itm_percent: 0.5,
      official: true,
    },
  ), policy), "unexpected_mutation");
  assert.equal(payoutBrowserRequestBlockReason(request(
    `https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/tournaments?id=eq.${fixture.tournamentId}&select=id`,
    "PATCH",
    {
      planned_itm_percent: 0.5,
      planned_payout_archetype: "DAILY",
      planned_min_cash_x: 1,
      planned_rounding_unit: 1,
    },
  ), policy), null);
  assert.equal(payoutBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/payout_templates",
    "POST",
    {
      club_id: fixture.clubId,
      name: policy.templateName,
      archetype: "CUSTOM",
      custom_percents: [
        { position: 1, percent_bp: 5000 },
        { position: 2, percent_bp: 3000 },
        { position: 3, percent_bp: 2000 },
      ],
      itm_percent: 0,
      min_cash_x: 1,
      rounding_unit: 1,
      created_by: policy.ownerId,
    },
  ), policy), null);
  assert.equal(payoutBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/rpc/close_tournament",
    "POST",
    { p_tournament_id: fixture.tournamentId, p_reason: "close_report" },
  ), policy), null);
});

test("browser chip CAS policy permits only one exact owned stale-snapshot race", () => {
  const fixture = {
    tournamentId: "10000000-0000-4000-8000-000000000001",
  };
  const seat = {
    id: "20000000-0000-4000-8000-000000000001",
    player_id: "30000000-0000-4000-8000-000000000001",
    entry_number: 1,
    table_id: "40000000-0000-4000-8000-000000000001",
    seat_number: 1,
    player_name: "CODEX_FLOOR_CANARY_TEST_PLAYER",
  };
  const policy = {
    baseUrl: "https://vinpoker.vercel.app",
    fixture,
    seat,
    initialChip: 10000,
    candidateChips: [10101, 10202],
  };
  const update = (overrides = {}) => ({
    url: "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/tournament-live-draw",
    method: "POST",
    body: {
      tournament_id: fixture.tournamentId,
      action: "update_seats",
      seats: [{
        seat_id: seat.id,
        player_id: seat.player_id,
        entry_number: seat.entry_number,
        table_id: seat.table_id,
        seat_number: seat.seat_number,
        player_name: seat.player_name,
        chip_count: 10101,
        expected_chip_count: 10000,
        is_active: true,
        ...overrides,
      }],
    },
  });
  assert.equal(chipCasBrowserRequestBlockReason(update(), policy), null);
  assert.equal(chipCasBrowserRequestBlockReason(update({ expected_chip_count: 9999 }), policy), "unexpected_mutation");
  assert.equal(chipCasBrowserRequestBlockReason(update({ chip_count: 999999 }), policy), "unexpected_mutation");
  assert.equal(chipCasBrowserRequestBlockReason({
    url: "https://bank.example.test/pay",
    method: "POST",
    body: {},
  }, policy), "external_origin");
});

test("browser guards block known startup telemetry and push without allowing arbitrary egress", () => {
  const request = (url, method) => ({ url, method, body: null });
  assert.equal(expectedBlockedBrowserRequestReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/report-vitals",
    "POST",
  )), "expected_blocked_telemetry");
  assert.equal(expectedBlockedBrowserRequestReason(request(
    "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js",
    "GET",
  )), "expected_blocked_push_bootstrap");
  assert.equal(expectedBlockedBrowserRequestReason(request(
    "https://bank.example.test/pay",
    "POST",
  )), null);
  assert.equal(expectedBlockedBrowserRequestReason(request(
    "https://cdn.onesignal.com/unknown.js",
    "GET",
  )), null);
});

test("Auth response-loss recovery keeps known IDs when sign-in throws", async () => {
  const knownId = "10000000-0000-4000-8000-000000000001";
  let attempts = 0;
  const owned = {
    users: [knownId],
    actorAttempts: [
      { label: "owner", id: knownId, email: "known@example.invalid", password: "not-a-secret" },
      { label: "floor", id: null, email: "unknown@example.invalid", password: "not-a-secret" },
    ],
  };
  const createClientImpl = () => ({
    auth: {
      signInWithPassword: async () => {
        attempts += 1;
        throw new Error("network");
      },
    },
  });
  const recovered = await recoverAttemptedAuthUserIds("test-anon", "https://example.invalid", owned, createClientImpl);
  assert.deepEqual(recovered.ids, [knownId]);
  assert.deepEqual(recovered.unresolvedRoles, ["floor"]);
  assert.equal(attempts, 3);
});

test("Auth cleanup attempts every exact ID before reporting aggregate failure", async () => {
  const firstId = "10000000-0000-4000-8000-000000000001";
  const secondId = "20000000-0000-4000-8000-000000000001";
  const deletes = [];
  const admin = {
    auth: {
      admin: {
        deleteUser: async (id) => {
          deletes.push(id);
          if (id === firstId) throw new Error("network");
          return { error: null };
        },
        getUserById: async (id) => (
          id === firstId
            ? { error: null, data: { user: { id } } }
            : { error: { status: 404, code: "user_not_found" }, data: { user: null } }
        ),
      },
    },
  };
  await assert.rejects(
    deleteExactAuthUsersBestEffort(admin, [firstId, secondId], async () => {}),
    /cleanup_auth_users_incomplete/,
  );
  assert.equal(deletes.filter((id) => id === firstId).length, 3);
  assert.equal(deletes.filter((id) => id === secondId).length, 1);
});

test("Playwright child receives only an allowlisted non-secret environment", () => {
  const childEnvironment = canarySource.slice(
    canarySource.indexOf("function browserChildEnvironment"),
    canarySource.indexOf("async function runBrowserManifest"),
  );
  assert.match(childEnvironment, /PLAYWRIGHT_BASE_URL/);
  assert.match(childEnvironment, /FLOOR_UAT_STORAGE_STATE_DIR/);
  assert.doesNotMatch(childEnvironment, /\.\.\.process\.env/);
  assert.doesNotMatch(childEnvironment, /SUPABASE_(ANON_KEY|SERVICE_ROLE_KEY)/);
});

test("blocked browser evidence contains only reason, method, and pathname", () => {
  const safeDetail = canarySource.slice(
    canarySource.indexOf("function safeBlockedBrowserRequestDetail"),
    canarySource.indexOf("function payoutBrowserRequestBlockReason"),
  );
  assert.match(safeDetail, /reason=\$\{reason\} method=\$\{method\} path=\$\{safePath\}/);
  assert.match(safeDetail, /new URL\(request\.url\)\.pathname/);
  assert.doesNotMatch(safeDetail, /searchParams|\.search\b|\.href\b|request\.body|headers/);
  assert.match(canarySource, /\[\.\.\.new Set\(forbiddenEgress\)\]\.join\(","\)/);
});

test("browser chip concurrency selects only the exact run-owned table", () => {
  const chipDialog = canarySource.slice(
    canarySource.indexOf("async function openOwnedChipDialog"),
    canarySource.indexOf("async function runBrowserChipCasConcurrency"),
  );
  assert.match(chipDialog, /fixture\.tableName\.startsWith\(`\$\{fixture\.runId\}_\$\{fixture\.scenario\}_`\)/);
  assert.match(chipDialog, /escapeRegex\(fixture\.tableName\)/);
  assert.match(chipDialog, /browser_chip_table_ownership_invalid/);
  assert.match(chipDialog, /name: \/\^Sửa chip\(\?:\\s\|\$\)\/u/);
  assert.match(chipDialog, /editChipButton\.waitFor\(\{ state: "visible", timeout: 15_000 \}\)/);
  assert.doesNotMatch(chipDialog, /name: "Sửa chip", exact: true/);
  assert.doesNotMatch(chipDialog, /\^Bàn 1/);
});

test("production canary pins Vietnamese locale for every browser context", () => {
  assert.match(canarySource, /const CANARY_BROWSER_LOCALE = "vi-VN"/);
  assert.match(canarySource, /const CANARY_SIGN_IN_LABEL = "Đăng nhập"/);
  const newContextCount = (canarySource.match(/browser\.newContext\(/g) ?? []).length;
  const pinnedLocaleCount = (canarySource.match(/locale: CANARY_BROWSER_LOCALE/g) ?? []).length;
  assert.ok(newContextCount > 0);
  assert.equal(pinnedLocaleCount, newContextCount);
  assert.match(canarySource, /getByRole\("button", \{ name: CANARY_SIGN_IN_LABEL, exact: true \}\)/);
  assert.doesNotMatch(canarySource, /getByRole\("button", \{ name: "Sign In"/);
});

test("browser actor login waits for the sign-in navigation before testing an authenticated route", () => {
  const browserManifest = canarySource.slice(canarySource.indexOf("function browserIsOnAuthRoute"));
  assert.match(browserManifest, /async function waitForSignInNavigation\(page\)/);
  assert.match(browserManifest, /page\.waitForURL\(\(url\) => new URL\(url\)\.pathname === "\/"/);
  assert.match(browserManifest, /async function navigateAuthenticatedOps\(page, baseUrl\)/);
  assert.match(browserManifest, /attempt <= 3/);
  assert.match(browserManifest, /poll <= 30/);
  assert.match(browserManifest, /name: "App chính", exact: true/);
  assert.match(browserManifest, /waitForTimeout\(attempt \* 500\)/);
  assert.doesNotMatch(browserManifest, /if \(!browserIsOnAuthRoute\(page\)\) return true/);
  assert.match(browserManifest, /const signInNavigation = waitForSignInNavigation\(page\)/);
  assert.match(browserManifest, /const signInSucceeded = await signInNavigation/);
  assert.match(browserManifest, /result\(`browser_signin_navigation_\$\{actor\.label\}`, signInSucceeded\)/);
  assert.match(browserManifest, /const opsAuthenticated = signInSucceeded && await navigateAuthenticatedOps\(page, baseUrl\)/);
  assert.match(browserManifest, /result\(`browser_ops_authenticated_\$\{actor\.label\}`, opsAuthenticated\)/);
});

test("cashier browser assertions classify a redacted allowed or denied UI outcome", () => {
  const browserManifest = canarySource.slice(canarySource.indexOf("async function resolveCashierRouteAccess"));
  assert.match(browserManifest, /async function resolveCashierRouteAccess\(page, baseUrl, expectedAccess, roleLabel\)/);
  assert.match(browserManifest, /attempt <= 3/);
  assert.match(browserManifest, /poll <= 30/);
  assert.match(browserManifest, /name: "Hàng chờ", exact: true/);
  assert.match(browserManifest, /getByText\("Không có quyền Cashier", \{ exact: true \}\)/);
  assert.match(browserManifest, /outcome=\$\{outcome\}/);
  assert.match(browserManifest, /outcome = "scope_error"/);
  assert.match(browserManifest, /outcome = "club_unassigned"/);
  assert.match(browserManifest, /outcome = "data_error"/);
  assert.match(browserManifest, /return \{ passed: false, outcome: "unresolved" \}/);
  assert.match(browserManifest, /resolveCashierRouteAccess\(page, baseUrl, false, actor\.label\)/);
  assert.match(browserManifest, /resolveCashierRouteAccess\(page, baseUrl, true, actor\.label\)/);
  assert.doesNotMatch(browserManifest, /textContent\(|innerText\(|body\(\)/);
});

test("workflow has fail-closed run, cleanup, and hold modes", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/floor-production-canary.yml", import.meta.url), "utf8");
  assert.match(workflow, /type: choice/);
  assert.doesNotMatch(workflow, /\[rollout\]|^\s+- rollout$/m);
  assert.match(workflow, /- cleanup/);
  assert.match(workflow, /- hold/);
  assert.match(workflow, /title == 'test\(floor\): controlled production canary runner \[cleanup\]'/);
  assert.match(workflow, /pull_request\.number == 912/);
  assert.match(workflow, /pull_request\.draft == true/);
  assert.match(workflow, /pull_request\.base\.ref == 'main'/);
  assert.match(workflow, /if: env\.FLOOR_CANARY_MODE == 'run'/);
  assert.match(workflow, /FLOOR_CANARY_MODE:/);
  assert.match(workflow, /FLOOR_CANARY_BROWSER_ACTIONS_READY: "true"/);
  assert.doesNotMatch(workflow, /SUPABASE_ACCESS_TOKEN|SUPABASEACCESSTOKEN/);
  assert.doesNotMatch(workflow, /supabase functions deploy|database\/query/);
});
