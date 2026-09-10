# Intelligence Wave 2: Overview and festival context

## Identity and boundaries

- BASE SHA: `155a4f5adab2187fbcfe2695e6a310aeeea5d8e4` (latest fetched main at branch creation).
- Branch: `codex/intelligence-wave2-overview-context`.
- HEAD SHA: recorded in the source PR after the evidence commit; review that exact PR head.
- Prior Wave 1/Q0 closeout `e47e4409c2adfb5b8bdbc6ea6aca95ca578bad3b` is an ancestor. The intervening #1226 diff was Tracker-only, with no Q1 overlap.
- SOURCE: read-only Overview, shared context, pending read-only RPC. No Wave 3-6 work.
- LOCAL E2E: synthetic fixtures only, real `/ops/select-module` route and Ops auth/capability gate.
- USER_VISIBLE: local route/screenshots verified; no Wave 2 production visibility claim.
- PRODUCTION: read-only schema/relationship inspection only. No DB apply, Edge/frontend deployment, flag change, business record, Gemini call, or historical repair.

## Server contract and ID semantics

`get_ops_intelligence_context_v1(p_club_id uuid)` returns strict JSON version
`ops-intelligence-context-v1`, clubId, server asOf, dailyTournaments and festivals.

| UI scope | Canonical identity / relation | Tournament RPC allowed |
| --- | --- | --- |
| Club | `clubs.id` | No selected tournament |
| Daily | `tournaments.id`, `event_id IS NULL` | Exact tournament ID |
| Festival | `tournament_events.id` | Never |
| Flight / Final | `tournaments.id`, exact `event_id` parent and explicit `phase` | Exact child tournament ID |
| Unknown child role | Phase preserved, readiness reason shown | No inferred flight/final drilldown |

The production catalog inspection found only two festival-referencing RPCs:
`advance_flight_qualifiers` and `create_tournament_event_with_flights`, both writers,
not a reusable read inventory. Thus one pending read function was necessary.
Actual GTD column is `tournaments.guarantee_amount`. Owner helper inspected:
`is_club_owner(actor, club)` accepts a club's owner or canonical `super_admin` role.
The function additionally verifies auth.uid, non-null/existing club, club filters on
both parent and children, explicit empty search_path, and authenticated-only EXECUTE
(PUBLIC/anon revoked). Cross-club final pointers are not exposed.

Read-only production compatibility snapshot: one festival, zero non-deleted linked
tournaments, zero cross-club links. This is not a claim that all history is absent:
soft-deleted/history rows and other business datasets are distinct. No historical
data was changed or required to be perfect.

## Disposable PostgreSQL 17

Docker startup was unavailable. Used installed PostgreSQL **17.11**, a new local
cluster bound only to `127.0.0.1:55482`, database `wave2_context_disposable`.
No production connection was used for test execution. The local instance was stopped.

Reproduce only on a fresh named disposable PG17 database with:
`psql -X -v ON_ERROR_STOP=1 -f tests/ops/intelligenceContext.disposable.sql`.
The test rejects another database name or PostgreSQL major version.

Result: `WAVE2_CONTEXT_PG17_PASS`.

- Apply and reapply the pending function; exactly one overload and correct ACL.
- Daily is not linked; exact zero buy-in remains zero, missing GTD remains null.
- Festival has Flight A, Flight B, Final, exact parent/final pointer.
- Null phase/start and missing final remain null, not manufactured.
- Malicious child from club B linked to festival A is excluded.
- Owner A cannot request B; missing auth, non-owner, null/unknown club denied.
- Super Admin can read an existing club; legacy PostgreSQL UUID accepted.
- Owner club without data returns exact empty arrays.

## Frontend and network evidence

Overview is the default. One typed workspace scope owns selection; Quant draft only
owns assumptions. A pressure-row change updates the same shared scope. Unknown or
removed identities fail closed rather than selecting another event. Actor/club
changes clear the scoped cache and draft before the new reader mount.

Context is the only workspace-lifetime query. Existing canonical query factories
are reused; other readers mount only in the active view. The StrictMode replay test
exposed duplicate initial reads from cleanup; lifecycle cleanup now distinguishes
effect replay from workspace exit without delaying actor/club cache invalidation.
Independent read-only audit found a destination-cache P1: a prefilled incoming club
cache could survive an actor/club transition. Fixed by holding the initial mount and
purging both previous and incoming club query scopes before releasing readers.
A regression seeds both initial and destination caches with a prior actor's data.
Independent auditor recheck: PASS (source-only); no remaining P0/P1/P2 findings
in the changed workspace boundary/test. Auditor did not run live commands or tests.

Route tests verify one initial context, registration and SePay request across all
tab switches, cache/Custom retention, zero polling over 65 simulated seconds, no
hidden Finance/history/prize readers in Overview, no festival ID in prize-pool
requests, and zero readers under spaces/non-owner/unverified-SA/sub-1280 gates.
Live Ops and Data Health explicitly retain their club-wide grain.

Daily: exact selected tournament, scoped entries/allocation, source drawer, Quant
drilldown and return. Festival: A/B/C/Final, no aggregate GTD/unique-player sum,
exact Flight B drilldown retaining its parent, null-role/missing-time/final gaps.
Custom regression, source errors, removed events, zero/missing and receipt stability
remain covered. Exact empty Q0 does not prevent club observations/context display.

## Validation

| Check | Result |
| --- | --- |
| Intelligence + Ops auth Vitest | 147 passed (17 files) |
| Real-route mock Playwright | 13 passed (40.6s), four viewports |
| Context disposable PG17 | PASS, including apply/reapply and ACL/cross-club |
| Focused tsc: ops-v3-registry | PASS |
| Focused tsc: ops-v3-finance-series | PASS |
| Targeted ESLint | PASS, zero warnings |
| check:ops-boundary | PASS, 149 files |
| check:ops-money-boundary | PASS |
| check:owner-digest-read-boundary | PASS |
| check:ops-v3-shell-text | PASS |
| check:credential-context | PASS |
| Normal production build | PASS, rerun after cache fix (69s) |
| Constrained build (4096MB heap, GOMAXPROCS=2) | PASS, rerun after cache fix |
| Full tsc -b | NOT_MEASURED: bounded 90s, no diagnostics before termination |
| Changed-source secret-pattern scan | PASS; credential guard separately passed |
| Package/flag/control-plane/version allowlist | Unchanged |
| git diff --check | PASS |

Existing build warnings: old browserslist database, mixed dynamic/static imports,
large chunks. No dependency upgrade or unrelated build refactor was made.
Gitleaks executable was unavailable; do not describe the targeted pattern scan as
a full Gitleaks audit. Authenticated production UAT and production migration/deploy
remain NOT_MEASURED for Wave 2.

## Visual acceptance

Real-route mock Playwright at 1440x900 and 1920x1080 desktop; 1194x834 and 390x844
retain the legacy selector. No horizontal overflow, console/page errors or
reduced-motion regression in the exercised flows. Source sheet opens via an actual
button and closes by Escape. Only these two screenshots belong to this wave:

- [Daily Overview 1440x900](evidence/wave2/overview-daily-1440x900.png)
- [Festival Overview 1440x900](evidence/wave2/overview-festival-1440x900.png)

## Remaining / rollout boundary

One Draft source PR for review. Do not merge, apply the pending RPC or deploy from
this source task. Review the read contract first; production apply and exact frontend
promotion are separate owner gates. Existing `opsQuantDashboardQ1` remains unchanged.
Rollback source is the existing Q1 kill-switch or reverting this wave; dropping the
new read function is separately gated and does not change business data.
