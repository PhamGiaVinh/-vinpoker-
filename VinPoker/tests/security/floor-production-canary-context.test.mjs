import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  browserStateRootPath,
  chipCasBrowserRequestBlockReason,
  cleanupExactLedger,
  cleanupRecoveryLedger,
  clockBrowserRequestBlockReason,
  createRunId,
  deleteExactAuthUsersBestEffort,
  discoverCleanupScope,
  expectedBlockedBrowserRequestReason,
  finalizeControlEvidence,
  payoutBrowserRequestBlockReason,
  readOnlyBrowserRequestBlockReason,
  recoveryLedgerPath,
  recoverAttemptedAuthUserIds,
  requireProductionCanaryContext,
  runSequentialBrowserPhases,
  tableOpsBrowserRequestBlockReason,
  validateRecoveryLedger,
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

test("fails closed when the run-mode browser action matrix is not ready", () => {
  assert.throws(
    () => requireProductionCanaryContext({
      ...valid,
      FLOOR_CANARY_BROWSER_ACTIONS_READY: "false",
    }),
    /browser_action_matrix_not_ready/,
  );
});

test("cleanup mode does not require the browser action matrix to be ready", () => {
  assert.equal(requireProductionCanaryContext({
    ...valid,
    FLOOR_CANARY_MODE: "cleanup",
    FLOOR_CANARY_BROWSER_ACTIONS_READY: "false",
  }).mode, "cleanup");
});

test("recovery journal is exact, runner-temp confined, and can remove actors before any club exists", async () => {
  const runId = "CODEX_FLOOR_CANARY_20990101120000_aaaaaaaa";
  const actorId = "10000000-0000-4000-8000-000000000001";
  const recovery = validateRecoveryLedger({
    version: 1,
    runId,
    authUserIds: [actorId],
    clubIds: [],
  });
  assert.equal(recovery.runId, runId);
  assert.throws(
    () => recoveryLedgerPath({
      RUNNER_TEMP: "D:/runner-temp",
      FLOOR_CANARY_RECOVERY_LEDGER: "D:/outside/recovery.json",
    }),
    /recovery_ledger_path_outside_runner_temp/,
  );
  assert.match(browserStateRootPath({
    RUNNER_TEMP: "D:/runner-temp",
    FLOOR_CANARY_STATE_ROOT: "D:/runner-temp/floor-canary-state-123-1",
  }), /floor-canary-state-123-1$/);
  assert.throws(
    () => browserStateRootPath({
      RUNNER_TEMP: "D:/runner-temp",
      FLOOR_CANARY_STATE_ROOT: "D:/outside/floor-canary-state-123-1",
    }),
    /browser_state_root_outside_runner_temp/,
  );
  assert.throws(
    () => validateRecoveryLedger({ ...recovery, authUserIds: ["not-a-uuid"] }),
    /recovery_ledger_invalid/,
  );

  const users = new Set([actorId]);
  const deleted = [];
  const admin = {
    auth: {
      admin: {
        getUserById: async (id) => users.has(id)
          ? { error: null, data: { user: { id, email: `${runId.toLowerCase()}-floor@floor-canary.invalid` } } }
          : { error: { status: 404, code: "user_not_found" }, data: { user: null } },
        deleteUser: async (id) => {
          deleted.push(id);
          users.delete(id);
          return { error: null };
        },
      },
    },
  };
  await cleanupRecoveryLedger(admin, recovery);
  assert.deepEqual(deleted, [actorId]);
  assert.equal(users.size, 0);
});

function exactCleanupAdmin({ clubRow = null, failClubDelete = false, authUsers = new Set() } = {}) {
  let remainingClub = clubRow;
  const authDeletes = [];
  const dbDeletes = [];
  return {
    authDeletes,
    dbDeletes,
    auth: {
      admin: {
        getUserById: async (id) => authUsers.has(id)
          ? { error: null, data: { user: { id, email: "unexpected@example.invalid" } } }
          : { error: { status: 404, code: "user_not_found" }, data: { user: null } },
        deleteUser: async (id) => {
          authDeletes.push(id);
          authUsers.delete(id);
          return { error: null };
        },
      },
    },
    from(table) {
      const state = { operation: null, columns: null, options: null };
      return {
        select(columns, options) {
          state.operation = "select";
          state.columns = columns;
          state.options = options;
          return this;
        },
        delete() {
          state.operation = "delete";
          return this;
        },
        in(column, ids) {
          if (state.operation === "delete") {
            dbDeletes.push({ table, column, ids: [...ids] });
            if (table === "clubs" && failClubDelete) {
              return Promise.resolve({ data: null, error: { code: "23503" } });
            }
            if (table === "clubs") remainingClub = null;
            return Promise.resolve({ data: [], error: null });
          }
          if (state.options?.head === true) {
            return Promise.resolve({
              data: null,
              error: null,
              count: table === "clubs" && remainingClub ? 1 : 0,
            });
          }
          if (table === "clubs" && state.columns === "id,name,region,owner_id") {
            return Promise.resolve({ data: remainingClub ? [remainingClub] : [], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
      };
    },
  };
}

test("relational cleanup failure preserves exact Auth actors for a safe retry", async () => {
  const clubId = "10000000-0000-4000-8000-000000000001";
  const actorId = "20000000-0000-4000-8000-000000000001";
  const admin = exactCleanupAdmin({ failClubDelete: true, authUsers: new Set([actorId]) });
  const ledger = {
    runId: "CODEX_FLOOR_CANARY_20990101120000_aaaaaaaa",
    clubIds: [clubId],
    tournamentIds: [],
    tournamentTableIds: [],
    gameTableIds: [],
    levels: [],
    entries: [],
    seats: [],
    auditRows: [],
    auditLogIds: [],
    cashierMemberships: [],
    floorMemberships: [],
    authUserIds: [actorId],
    userIds: [actorId],
    stakingDealIds: [],
    childRows: {},
  };
  await assert.rejects(cleanupExactLedger(admin, ledger), /CLEANUP FAIL - REMAINING_ROWS/);
  assert.deepEqual(admin.authDeletes, []);
});

test("recovery cleanup accepts an exact journal club after its Auth owner was already deleted", async () => {
  const runId = "CODEX_FLOOR_CANARY_20990101120000_aaaaaaaa";
  const clubId = "10000000-0000-4000-8000-000000000001";
  const actorIds = [
    "20000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002",
    "20000000-0000-4000-8000-000000000003",
    "20000000-0000-4000-8000-000000000004",
  ];
  const admin = exactCleanupAdmin({
    clubRow: {
      id: clubId,
      name: `${runId}_ACCESS`,
      region: "TEST",
      owner_id: null,
    },
  });
  await cleanupRecoveryLedger(admin, {
    version: 1,
    runId,
    authUserIds: actorIds,
    clubIds: [clubId],
  });
  assert.ok(admin.dbDeletes.some((entry) => entry.table === "clubs" && entry.ids[0] === clubId));
  assert.deepEqual(admin.authDeletes, []);
});

test("cleanup mode branches before provisioning or browser execution", () => {
  const cleanupBranch = canarySource.indexOf('if (context.mode === "cleanup")');
  assert.notEqual(cleanupBranch, -1);
  const cleanupBody = canarySource.slice(cleanupBranch, canarySource.indexOf("const runId", cleanupBranch));
  assert.match(cleanupBody, /await runCleanupCanary\(admin, \{/);
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
  assert.match(canarySource, /runBrowserManifest\(admin, actors, fixtures, owned\.clubs\)/);
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
  const manifest = canarySource.slice(
    canarySource.indexOf("async function runBrowserManifest"),
    canarySource.indexOf("async function deleteExact"),
  );
  const payoutPhaseStart = manifest.indexOf('"payout_close",');
  const payoutPhaseEnd = manifest.indexOf('"public_tv_controls",', payoutPhaseStart);
  const payoutPhase = manifest.slice(payoutPhaseStart, payoutPhaseEnd);
  const browser = payoutPhase.indexOf("await runPayoutAndCloseBrowserFlow");
  const verify = payoutPhase.indexOf("await verifyPayoutCloseAfterBrowser", browser);
  assert.ok(prepare >= 0 && payoutPhaseStart >= 0 && payoutPhaseEnd > payoutPhaseStart && browser >= 0 && verify > browser);
  assert.match(manifest, /const runClickedAction = async \(manifestIds, action\) => \{\s*try \{\s*await action\(\);\s*markClicked\(manifestIds\);/);
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
    actorId: "30000000-0000-4000-8000-000000000001",
    actorIds: ["30000000-0000-4000-8000-000000000001"],
    allowAuthToken: false,
  };
  const request = (url, method, body = null) => ({ url, method, body });
  assert.equal(payoutBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/auth/v1/user",
    "GET",
  ), policy), null);
  assert.equal(payoutBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/auth/v1/user?unexpected=1",
    "GET",
  ), policy), "unexpected_read");
  assert.equal(payoutBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/auth/v1/user",
    "GET",
  ), { ...policy, actorIds: [] }), "unexpected_read");
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
      created_by: null,
    },
  ), policy), "unexpected_mutation");
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
  const actorId = "30000000-0000-4000-8000-000000000001";
  const tournamentId = "40000000-0000-4000-8000-000000000001";
  const policy = {
    actorId,
    actorIds: [actorId],
    baseUrl: "https://vinpoker.vercel.app",
    ownedRecordIds: [actorId, tournamentId],
    tournamentIds: [tournamentId],
  };
  const request = (url, method, body = null, bodyPresent = body != null) => ({
    url,
    method,
    body,
    bodyPresent,
  });
  assert.equal(expectedBlockedBrowserRequestReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/report-vitals",
    "POST",
  )), "expected_blocked_telemetry");
  assert.equal(expectedBlockedBrowserRequestReason(request(
    "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js",
    "GET",
  )), "expected_blocked_push_bootstrap");
  assert.equal(expectedBlockedBrowserRequestReason(request(
    `https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/profiles?user_id=eq.${actorId}`,
    "PATCH",
    { onesignal_external_user_id: actorId },
  ), policy), "expected_blocked_profile_push_link");
  assert.equal(expectedBlockedBrowserRequestReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/send-welcome-email",
    "POST",
    {},
  ), policy), "expected_blocked_welcome_email");
  for (const url of [
    "https://vinpoker.vercel.app/?history=1",
    "https://vinpoker.vercel.app/version.json?cache=1",
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/gto_spot_ranges",
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/dealer_assignments",
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/dealer_attendance",
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/dealers",
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/tournament_registrations",
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/booking_chats",
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/club_accountants",
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/club_chip_masters",
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/club_fnb_staff",
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/club_marketers",
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/notifications",
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/profiles",
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/user_roles",
  ]) {
    for (const method of ["GET", "HEAD"]) {
      assert.equal(
        expectedBlockedBrowserRequestReason(request(url, method), policy),
        "expected_blocked_optional_bootstrap_read",
      );
    }
  }
  assert.equal(expectedBlockedBrowserRequestReason(request(
    `https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/tournament_registrations?tournament_id=eq.${tournamentId}`,
    "GET",
  ), policy), null);
  for (const url of [
    "https://vinpoker.vercel.app/",
    "https://vinpoker.vercel.app/version.json",
  ]) {
    assert.equal(readOnlyBrowserRequestBlockReason(request(url, "GET"), policy), null);
    assert.equal(expectedBlockedBrowserRequestReason(request(url, "GET"), policy), null);
  }
  for (const table of [
    "user_roles",
    "dealers",
    "club_accountants",
    "club_chip_masters",
    "club_marketers",
    "club_fnb_staff",
    "notifications",
  ]) {
    const method = table === "notifications" ? "HEAD" : "GET";
    const scopedRequest = request(
      `https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/${table}?user_id=eq.${actorId}`,
      method,
    );
    assert.equal(readOnlyBrowserRequestBlockReason(scopedRequest, policy), "unexpected_read");
    assert.equal(
      expectedBlockedBrowserRequestReason(scopedRequest, policy),
      "expected_blocked_optional_bootstrap_read",
    );
    assert.equal(readOnlyBrowserRequestBlockReason(request(
      `https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/${table}`,
      "GET",
    ), policy), "unexpected_read");
  }
  const ownedProfileRead = request(
    `https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/profiles?user_id=eq.${actorId}`,
    "GET",
  );
  assert.equal(readOnlyBrowserRequestBlockReason(ownedProfileRead, policy), null);
  assert.equal(expectedBlockedBrowserRequestReason(ownedProfileRead, policy), null);
  const unownedActorId = "30000000-0000-4000-8000-000000000099";
  for (const table of ["profiles", "user_roles"]) {
    assert.equal(expectedBlockedBrowserRequestReason(request(
      `https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/${table}?user_id=eq.${unownedActorId}`,
      "GET",
    ), policy), null);
  }
  assert.equal(expectedBlockedBrowserRequestReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/unknown_table",
    "GET",
  ), policy), null);
  assert.equal(expectedBlockedBrowserRequestReason(request(
    `https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/profiles?user_id=eq.${actorId}`,
    "PATCH",
    { is_verified: true },
  ), policy), null);
  assert.equal(expectedBlockedBrowserRequestReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/send-welcome-email",
    "POST",
    { recipient: actorId },
  ), policy), null);
  assert.equal(expectedBlockedBrowserRequestReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/send-welcome-email?recipient=unexpected",
    "POST",
    {},
  ), policy), null);
  assert.equal(expectedBlockedBrowserRequestReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/send-welcome-email",
    "POST",
    null,
    true,
  ), policy), null);
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
  assert.match(childEnvironment, /FLOOR_UAT_CONTROL_EVIDENCE_PATH/);
  assert.doesNotMatch(childEnvironment, /\.\.\.process\.env/);
  assert.doesNotMatch(childEnvironment, /SUPABASE_(ANON_KEY|SERVICE_ROLE_KEY)/);
});

test("read-only browser policy permits exact TEST reads and blocks every mutation", () => {
  const actorId = "30000000-0000-4000-8000-000000000001";
  const tournamentId = "40000000-0000-4000-8000-000000000001";
  const policy = {
    baseUrl: "https://vinpoker.vercel.app",
    actorIds: [actorId],
    tournamentIds: [tournamentId],
    allowAuthToken: true,
    authEmail: "codex_floor_canary_20990101120000_aaaaaaaa-floor@floor-canary.invalid",
    authPassword: "x".repeat(32),
  };
  const request = (url, method, body = null) => ({ url, method, body });
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/auth/v1/token?grant_type=password",
    "POST",
    {
      email: policy.authEmail,
      password: policy.authPassword,
      gotrue_meta_security: {},
    },
  ), policy), null);
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    `https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/tournaments?select=id&id=eq.${tournamentId}`,
    "GET",
  ), policy), null);
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    "https://vinpoker.vercel.app/ops/tournaments",
    "GET",
  ), policy), null);
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/rpc/get_my_floor_operator_scope",
    "POST",
    {},
  ), policy), null);
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/rpc/get_tournament_clock",
    "POST",
    { p_tournament_id: tournamentId },
  ), policy), null);
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/tournament-live-draw",
    "POST",
    { tournament_id: tournamentId, action: "get_seats" },
  ), policy), null);
  for (const [url, body] of [
    ["https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/tournaments", { status: "completed" }],
    ["https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/tournament-live-draw", { tournament_id: tournamentId, action: "update_seats" }],
    ["https://bank.example.test/pay", {}],
  ]) {
    assert.notEqual(readOnlyBrowserRequestBlockReason(request(url, "POST", body), policy), null);
  }
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/auth/v1/token",
    "POST",
    {},
  ), { ...policy, allowAuthToken: false }), "unexpected_mutation");
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/auth/v1/token?grant_type=password",
    "POST",
    {
      email: "existing-production-user@example.com",
      password: policy.authPassword,
      gotrue_meta_security: {},
    },
  ), policy), "unexpected_mutation");
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/auth/v1/token?grant_type=refresh_token",
    "POST",
    {
      email: policy.authEmail,
      password: policy.authPassword,
      gotrue_meta_security: {},
    },
  ), policy), "unexpected_mutation");
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/auth/v1/token?grant_type=password",
    "POST",
    {
      email: policy.authEmail,
      password: policy.authPassword,
      gotrue_meta_security: {},
      extra: true,
    },
  ), policy), "unexpected_mutation");
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/auth/v1/token?grant_type=password",
    "POST",
    {
      email: policy.authEmail,
      password: "wrong-test-password",
      gotrue_meta_security: {},
    },
  ), policy), "unexpected_mutation");
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/tournaments?select=*",
    "GET",
  ), policy), "unexpected_read");
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/tournaments?select=id&id=eq.40000000-0000-4000-8000-000000000099",
    "GET",
  ), policy), "unexpected_read");
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    `https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/tournaments?select=id&or=(id.eq.${tournamentId},status.eq.active)`,
    "GET",
  ), policy), "unexpected_read");
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/tournament-live-draw",
    "GET",
  ), policy), "unexpected_read");
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/unknown?actor_id=eq.30000000-0000-4000-8000-000000000001",
    "HEAD",
  ), policy), "unexpected_read");
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/rpc/unknown",
    "OPTIONS",
  ), policy), "unexpected_read");
  assert.equal(readOnlyBrowserRequestBlockReason(request(
    "https://vinpoker.vercel.app/api/unknown",
    "GET",
  ), policy), "unexpected_read");
});

test("table browser policy allows only exact run-owned Floor mutations", () => {
  const tournamentId = "40000000-0000-4000-8000-000000000001";
  const tableId = "50000000-0000-4000-8000-000000000001";
  const targetTableId = "50000000-0000-4000-8000-000000000002";
  const entryId = "60000000-0000-4000-8000-000000000001";
  const seatId = "70000000-0000-4000-8000-000000000001";
  const playerId = "80000000-0000-4000-8000-000000000001";
  const createdSeatId = "90000000-0000-4000-8000-000000000001";
  const policy = {
    baseUrl: "https://vinpoker.vercel.app",
    actorId: "30000000-0000-4000-8000-000000000001",
    tournamentIds: [tournamentId],
    ownedRecordIds: [createdSeatId],
    mutation: {
      openTable: { tournamentId, tableNumber: 22, maxSeats: 9 },
      addPlayer: { tournamentId, playerName: "CODEX_FLOOR_CANARY_PLAYER", tournamentTableId: tableId, seatNumber: 1 },
      movePlayer: { entryId, toTournamentTableId: targetTableId, toSeatNumber: 3, reason: "cân bàn" },
      closeTable: { tournamentTableId: tableId, drawMode: "redraw_balanced", reason: "table_break" },
      redraw: { tournamentId },
      bustSeat: {
        tournamentId,
        seatId,
        playerId,
        entryNumber: 1,
        tableId,
        seatNumber: 1,
        chipCount: 0,
        playerName: "CODEX_FLOOR_CANARY_PLAYER",
      },
      restorePlayer: { entryId, toTournamentTableId: targetTableId, toSeatNumber: 1 },
    },
  };
  const post = (path, body) => ({
    url: `https://orlesggcjamwuknxwcpk.supabase.co${path}`,
    method: "POST",
    body,
  });
  const allowed = [
    post("/rest/v1/rpc/open_tournament_table", { p_tournament_id: tournamentId, p_table_number: 22, p_max_seats: 9 }),
    post("/rest/v1/rpc/floor_assign_player_to_seat", { p_tournament_id: tournamentId, p_player_name: "CODEX_FLOOR_CANARY_PLAYER", p_tournament_table_id: tableId, p_seat_number: 1 }),
    post("/rest/v1/rpc/move_player_seat", { p_entry_id: entryId, p_to_tournament_table_id: targetTableId, p_to_seat_number: 3, p_reason: "cân bàn" }),
    post("/rest/v1/rpc/close_tournament_table", { p_tournament_table_id: tableId, p_draw_mode: "redraw_balanced", p_reason: "table_break" }),
    post("/rest/v1/rpc/redraw_tournament", { p_tournament_id: tournamentId, p_mode: "final_table", p_eligible_entry_ids: null, p_target_table_count: null, p_draw_mode: "redraw_balanced", p_dry_run: true }),
    post("/functions/v1/tournament-live-draw", { tournament_id: tournamentId, action: "update_seats", seats: [{ seat_id: seatId, player_id: playerId, entry_number: 1, table_id: tableId, seat_number: 1, expected_chip_count: 0, chip_count: 0, is_active: false, player_name: "CODEX_FLOOR_CANARY_PLAYER" }] }),
    post("/rest/v1/rpc/restore_busted_player_to_seat", { p_entry_id: entryId, p_to_tournament_table_id: targetTableId, p_to_seat_number: 1, p_reason: "floor_restore" }),
  ];
  for (const request of allowed) assert.equal(tableOpsBrowserRequestBlockReason(request, policy), null);
  assert.equal(tableOpsBrowserRequestBlockReason({
    url: `https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/tournament_seats?select=*&id=eq.${createdSeatId}`,
    method: "GET",
    body: null,
  }, policy), null);
  assert.equal(tableOpsBrowserRequestBlockReason({
    url: "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/tournament_seats?select=*&id=eq.90000000-0000-4000-8000-000000000099",
    method: "GET",
    body: null,
  }, policy), "unexpected_read");
  assert.equal(tableOpsBrowserRequestBlockReason(post(
    "/rest/v1/rpc/open_tournament_table",
    { p_tournament_id: tournamentId, p_table_number: 23, p_max_seats: 9 },
  ), policy), "unexpected_mutation");
  assert.equal(tableOpsBrowserRequestBlockReason(post(
    "/functions/v1/tournament-live-draw",
    { tournament_id: tournamentId, action: "update_seats", seats: [{ seat_id: seatId, player_id: playerId, entry_number: 1, table_id: tableId, seat_number: 1, expected_chip_count: 0, chip_count: 1, is_active: false, player_name: "CODEX_FLOOR_CANARY_PLAYER" }] },
  ), policy), "unexpected_mutation");
  assert.equal(tableOpsBrowserRequestBlockReason({
    url: "https://bank.example.test/pay",
    method: "POST",
    body: {},
  }, policy), "external_origin");
});

test("browser phase aggregation continues after failure and reports exact phase names", async () => {
  const executed = [];
  const logs = [];
  const originalLog = console.log;
  console.log = (...values) => logs.push(values.join(" "));
  let failures;
  try {
    failures = await runSequentialBrowserPhases([
      ["first", async () => { executed.push("first"); }],
      ["middle", async () => {
        executed.push("middle");
        throw new Error("sensitive detail must not escape");
      }],
      ["last", async () => { executed.push("last"); }],
    ]);
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(executed, ["first", "middle", "last"]);
  assert.deepEqual(failures, ["middle"]);
  assert.ok(logs.includes("FLOOR_CANARY FAIL browser_phase_middle error_class=other"));
  assert.ok(logs.every((line) => !line.includes("sensitive detail")));
});

test("button evidence finalizer requires complete known terminal evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "floor-evidence-test-"));
  const evidencePath = join(directory, "evidence.jsonl");
  const record = (manifestId, status, phase = "baseline") => ({
    manifestId,
    status,
    phase,
    route: "/floor",
    role: "floor",
    viewport: "all",
    stateMismatch: false,
  });
  try {
    await writeFile(
      evidencePath,
      [
        record("action", "BLOCKED"),
        record("navigation", "BLOCKED"),
        record("navigation", "NAVIGATION_ONLY", "discovery"),
        record("excluded", "EXCLUDED_WITH_REASON"),
      ].map((entry) => JSON.stringify(entry)).join("\n"),
    );
    const complete = await finalizeControlEvidence(
      evidencePath,
      new Map([["action", "CLICKED_PASS"]]),
      3,
    );
    assert.equal(complete.total, 3);
    await writeFile(
      evidencePath,
      [
        record("action", "BLOCKED"),
        { ...record("action", "BLOCKED", "discovery"), stateMismatch: true },
        record("navigation", "NAVIGATION_ONLY"),
        record("excluded", "EXCLUDED_WITH_REASON"),
      ].map((entry) => JSON.stringify(entry)).join("\n"),
    );
    await assert.rejects(
      finalizeControlEvidence(evidencePath, new Map([["action", "CLICKED_PASS"]]), 3),
      /button_evidence_incomplete/,
    );
    await writeFile(
      evidencePath,
      [
        record("action", "BLOCKED"),
        record("navigation", "BLOCKED"),
        record("navigation", "NAVIGATION_ONLY", "discovery"),
        record("excluded", "EXCLUDED_WITH_REASON"),
      ].map((entry) => JSON.stringify(entry)).join("\n"),
    );
    await assert.rejects(
      finalizeControlEvidence(evidencePath, new Map(), 3),
      /button_evidence_incomplete/,
    );
    await assert.rejects(
      finalizeControlEvidence(evidencePath, new Map([["unknown", "CLICKED_PASS"]]), 3),
      /button_action_unknown_manifest_id/,
    );
    await assert.rejects(
      finalizeControlEvidence(evidencePath, new Map([["action", "CLICKED_FAIL"]]), 3),
      /button_evidence_incomplete/,
    );
    await assert.rejects(
      finalizeControlEvidence(evidencePath, new Map([["action", "CLICKED_PASS"]]), 4),
      /button_evidence_manifest_count_mismatch/,
    );
    await assert.rejects(
      finalizeControlEvidence(
        evidencePath,
        new Map([["action", "CLICKED_PASS"]]),
        3,
        "0".repeat(64),
      ),
      /button_evidence_manifest_ids_mismatch/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser clock policy permits only exact owned clock controls", () => {
  const actorId = "30000000-0000-4000-8000-000000000001";
  const tournamentId = "40000000-0000-4000-8000-000000000001";
  const policy = {
    baseUrl: "https://vinpoker.vercel.app",
    actorId,
    fixture: { tournamentId, scenario: "SETUP_CLOCK" },
  };
  const request = (url, method, body = null) => ({ url, method, body });
  const revision = "a".repeat(32);
  assert.equal(clockBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/rest/v1/rpc/get_tournament_clock",
    "POST",
    { p_tournament_id: tournamentId },
  ), policy), null);
  assert.equal(clockBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/tournament-live-clock",
    "POST",
    { tournament_id: tournamentId, action: "start" },
  ), { ...policy, fixture: { tournamentId, scenario: "ACCESS" } }), null);
  for (const action of ["pause", "resume", "next_level", "previous_level"]) {
    assert.equal(clockBrowserRequestBlockReason(request(
      "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/tournament-live-clock",
      "POST",
      { tournament_id: tournamentId, action, expected_control_revision: revision },
    ), policy), null);
  }
  for (const delta_seconds of [-60, 60]) {
    assert.equal(clockBrowserRequestBlockReason(request(
      "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/tournament-live-clock",
      "POST",
      { tournament_id: tournamentId, action: "adjust_time", delta_seconds, expected_control_revision: revision },
    ), policy), null);
  }
  assert.equal(clockBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/tournament-live-clock",
    "POST",
    { tournament_id: tournamentId, action: "next_level", expected_control_revision: revision },
  ), { ...policy, fixture: { tournamentId, scenario: "ACCESS" } }), "unexpected_mutation");
  assert.equal(clockBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/tournament-live-clock",
    "POST",
    {
      tournament_id: "40000000-0000-4000-8000-000000000002",
      action: "pause",
      expected_control_revision: revision,
    },
  ), policy), "unexpected_mutation");
  assert.equal(clockBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/tournament-live-clock",
    "POST",
    { tournament_id: tournamentId, action: "pause" },
  ), policy), "unexpected_mutation");
  assert.equal(clockBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/tournament-live-clock",
    "POST",
    { tournament_id: tournamentId, action: "resume", expected_control_revision: "not-a-revision" },
  ), policy), "unexpected_mutation");
  assert.equal(clockBrowserRequestBlockReason(request(
    "https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/tournament-live-clock",
    "POST",
    {
      tournament_id: tournamentId,
      action: "adjust_time",
      delta_seconds: 120,
      expected_control_revision: revision,
    },
  ), policy), "unexpected_mutation");
  assert.equal(clockBrowserRequestBlockReason(request(
    "https://bank.example.test/pay",
    "POST",
    {},
  ), policy), "external_origin");
});

test("blocked browser evidence contains only reason, method, and pathname", () => {
  const safeDetail = canarySource.slice(
    canarySource.indexOf("function safeBlockedBrowserRequestDetail"),
    canarySource.indexOf("const CANARY_REST_READ_FILTERS"),
  );
  assert.match(safeDetail, /reason=\$\{reason\} method=\$\{method\} path=\$\{safePath\}/);
  assert.match(safeDetail, /new URL\(request\.url\)\.pathname/);
  assert.doesNotMatch(safeDetail, /searchParams|\.search\b|\.href\b|request\.body|headers/);
  assert.match(canarySource, /\[\.\.\.new Set\(forbiddenEgress\)\]\.join\(","\)/);
});

test("exact POST lifecycle diagnostics expose fixed checkpoints only", () => {
  const matcher = canarySource.slice(
    canarySource.indexOf("function isExactPostPathRequest"),
    canarySource.indexOf("async function observeExactPostLifecycle"),
  );
  const observer = canarySource.slice(
    canarySource.indexOf("async function observeExactPostLifecycle"),
    canarySource.indexOf("function ownedOpsTableButton"),
  );
  assert.match(matcher, /url\.origin === `https:\/\/\$\{PRODUCTION_REF\}\.supabase\.co`/);
  assert.match(matcher, /url\.pathname === pathname/);
  assert.match(observer, /request_seen/);
  assert.match(observer, /kind: "response"/);
  assert.match(observer, /request_failed/);
  assert.match(observer, /request_missing/);
  assert.match(observer, /response_missing/);
  assert.doesNotMatch(observer, /postData|headers|cookies|searchParams|request\.url\(\)|response\.url\(\)/);
  for (const checkpoint of [
    "restore_request_seen",
    "restore_response_seen",
    "restore_request_failed",
    "restore_request_missing",
    "restore_response_missing",
  ]) assert.match(canarySource, new RegExp(`browserPhaseCheckpoint\\(\"bust_restore\", \"${checkpoint}\"\\)`));
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
  const jobEnvironment = workflow.slice(workflow.indexOf("    env:"), workflow.indexOf("    steps:"));
  const auditStep = workflow.slice(
    workflow.indexOf("      - name: Validate canary context and execute isolated API matrix"),
    workflow.indexOf("      - name: Always verify exact canary cleanup after run"),
  );
  const cleanupStep = workflow.slice(workflow.indexOf("      - name: Always verify exact canary cleanup after run"));
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
  assert.match(workflow, /Validate canary safety and button evidence contracts/);
  assert.match(workflow, /floorActionEvidenceLedger\.test\.ts/);
  assert.match(workflow, /FLOOR_CANARY_BROWSER_ACTIONS_READY: "true"/);
  assert.doesNotMatch(jobEnvironment, /runner\.temp/);
  assert.match(auditStep, /FLOOR_CANARY_RECOVERY_LEDGER: \$\{\{ runner\.temp \}\}\/floor-canary-recovery-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\.json/);
  assert.match(auditStep, /FLOOR_CANARY_STATE_ROOT: \$\{\{ runner\.temp \}\}\/floor-canary-state-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(cleanupStep, /FLOOR_CANARY_RECOVERY_LEDGER: \$\{\{ runner\.temp \}\}\/floor-canary-recovery-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\.json/);
  assert.match(cleanupStep, /FLOOR_CANARY_STATE_ROOT: \$\{\{ runner\.temp \}\}\/floor-canary-state-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /Always verify exact canary cleanup after run/);
  assert.match(cleanupStep, /if: "\$\{\{ always\(\) && \(\(github\.event_name == 'workflow_dispatch' && inputs\.mode == 'run'\) \|\| \(github\.event_name == 'pull_request' && github\.event\.pull_request\.title == 'test\(floor\): controlled production canary runner \[run\]'\)\) \}\}"/);
  assert.doesNotMatch(cleanupStep, /if:.*env\.FLOOR_CANARY_MODE/);
  assert.match(workflow, /FLOOR_CANARY_CLEANUP_ALLOW_EMPTY: "true"/);
  assert.match(workflow, /timeout-minutes: 45/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(canarySource, /try \{\s*if \(browser\) await browser\.close\(\);\s*\} finally \{\s*await rm\(stateDirectory/);
  assert.doesNotMatch(workflow, /SUPABASE_ACCESS_TOKEN|SUPABASEACCESSTOKEN/);
  assert.doesNotMatch(workflow, /supabase functions deploy|database\/query/);
});
