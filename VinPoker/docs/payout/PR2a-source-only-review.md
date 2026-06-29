# PR-2a — Payout "Engine 3-neo" backend · SOURCE-ONLY review report

> **STATUS: SOURCE-ONLY. NOT APPLIED.** No `supabase db push`, no `schema_migrations` write, no Edge
> deploy, no production DB touched. To be applied later ONLY via the owner-approved controlled
> Management-API runbook (preflight → dry-run `BEGIN…ROLLBACK` → exact owner phrase → `BEGIN…COMMIT`
> → verify). Reviewer reads this first.

## Files
- `supabase/migrations/20261120000000_payout_engine.sql` — the migration (additive only).
- `supabase/migrations/_payout_engine_20261120_dryrun.sql` — diagnostic `BEGIN…ROLLBACK` block
  (leading `_` → the migration runner ignores it, mirroring `_dry_run_june_2026.sql`).

## Migration timestamp
`20261120000000`. Latest on `origin/main` (324591c) = `20261119000000_platform_bank_accounts_bank_bin.sql`,
so this sorts strictly after it — **no version collision**.

## Touched functions / objects (all NEW — nothing existing is altered or dropped)
| Object | Kind | Notes |
|---|---|---|
| `tournaments.registration_closed_at` + `planned_itm_percent` / `planned_payout_archetype` / `planned_min_cash_x` / `planned_rounding_unit` | columns | nullable, no volatile default |
| `tournament_payout_runs` | table | snapshot + audit of every finalize/regenerate/manual-edit |
| `payout_templates` | table | saved payout **plans** per club (settings, not rows) |
| `uq_payout_applied` | partial unique index | `WHERE status='applied'` → ≤1 applied run / tournament |
| `is_tournament_registration_closed(uuid)` | fn (STABLE, DEFINER) | `registration_closed_at IS NOT NULL OR live_status='finished'` |
| `assert_tournament_registration_open()` + `trg_entries_registration_open` | trigger fn + BEFORE INSERT trigger | the close-guard (see below) |
| `prepare_payout_snapshot(...)` | fn (DEFINER) | lock + terminal close + freeze snapshot; **never supersedes** |
| `apply_payout_run(...)` | fn (DEFINER) | re-verify invariants + write official payout; supersede only here |
| `save_tournament_prizes_v2(...)` | fn (DEFINER) | guarded manual edit → new applied run superseding old |

`update_tournament_prizes` / `get_tournament_prizes` are **kept untouched** (old manual panel still
works while `payoutEngine` flag is OFF).

## Close-guard — every entry-creating path is covered by ONE choke point
A `BEFORE INSERT` trigger on `tournament_entries` rejects inserts once `registration_closed_at IS NOT
NULL`, and takes `FOR SHARE` on the parent tournament row so it **serialises against
`prepare_payout_snapshot`’s `FOR UPDATE`** (no snapshot-count race). This guards all writers found by
grepping `INSERT INTO tournament_entries` on `origin/main`:

- `confirm_registration_and_assign_seat` — `20260807000001_rpc_confirm_and_assign.sql`, `20260811000000_p0_guard_v2_bind_actor_to_auth_uid.sql`
- `create_offline_buyin_and_seat` — `20260826000002…`, `20260826000003…`
- `reenter_tournament_player` / re-entry — `20260901000001_reenter_tournament_player.sql` (also covers `add_player_with_reentry`)
- `floor_assign_player_to_seat` — `20260913000000_floor_assign_player_to_seat.sql`
- `seat_day2_qualifiers` — `20261027000000_seat_day2_qualifiers.sql` (multi-day; also blocked at prepare by `MULTIDAY_UNSUPPORTED`)
- `20260825000001_seed_floor_test_data.sql` (seed) + any future/direct `INSERT INTO tournament_entries`

**No live cashier RPC is modified** — the trigger is the single, low-risk guard. Consequence (by
design): closing for payout also ends re-entry for that tournament.

## Invariants the DB re-checks in `apply_payout_run` (last line of defence)
`prize_pool == prize_pool_snapshot`; `Σ amount == prize_pool_snapshot` (NOT `entries×buyIn`);
positions `1..N` contiguous, no gap/dup; `amount ≥ 0`; monotone non-increasing; `itm_places == row
count`; `effective_floor ∈ [0, pool]`; **min-cash**: `N≥2 & not POOL_BELOW_MIN_CASH ⇒ last ==
effective_floor`; `N=1 ⇒ last == pool`. `percentage` is recomputed server-side, never trusted.

## Idempotency / concurrency (P0-1)
- Two concurrent `prepare` → resume the **same draft** (no duplicate); two concurrent `apply` → one
  applied, the second fails cleanly on `uq_payout_applied`.
- `regenerate` keeps the old `applied` run + `tournament_prizes` until the new `apply` succeeds —
  **supersede happens only inside `apply_payout_run`**, so an Edge/apply crash never destroys the live payout.
- Manual edit = new `applied` run superseding the old in one transaction.

## Verification performed (local, no DB)
- **Real Postgres-grammar parse** (`pgsql-parser` / libpg_query WASM, isolated install in scratchpad):
  `PARSE_OK` — migration **30 statements**, dry-run **6 statements**, zero syntax errors.
- `$$` delimiters balanced (10 = 5 functions); GRANT/REVOKE signatures match each function’s arg list.
- The embedded dry-run asserts object existence, that `is_tournament_registration_closed(unknown)=false`,
  that each write function’s early guards fire (`AUTH_REQUIRED` / `*_NOT_FOUND` / `MANUAL_EDIT_REASON_REQUIRED`),
  and that the row-invariant SQL detects good / gap / inversion sets — **to be run in the controlled dry-run txn**.

## DB / deploy safety — proof
- `git status` for this branch shows only the 3 added source files (migration + dry-run + this doc).
- **No** `supabase db push`, `migration up`, `db reset`, or `deploy_db` was run. `schema_migrations`
  was **not** written. **No** Edge function deployed. **No** live DB connection opened (no psql; the
  parse ran offline via WASM). No secrets printed/committed.

## Remaining questions before controlled apply
1. **Entry-count void set** — I count `tournament_entries` excluding `status IN
   ('void','voided','cancelled','canceled','refunded','rejected')` defensively. Confirm the real
   `tournament_entries.status` values (or confirm voids **delete** the row, in which case plain
   `count(*)` is already exact and the exclusion is a harmless no-op).
2. **Finalize permission** — currently owner/admin/cashier/floor may finalize. Restrict to owner/admin only?
3. **Manual edit monotonicity** — `save_tournament_prizes_v2` enforces monotone non-increasing. Keep, or
   allow operators to set a non-monotone official table?
4. **`tournament_prizes.amount NUMERIC(12,2)`** (~10^10 VND ceiling) is pre-existing. For extreme pools
   (>10 billion VND) a top payout could overflow. Widen to `NUMERIC(20,2)` in a later migration? (Out of
   PR-2a scope; realistic VinPoker pools are well under this.)
5. **`is_club_*(uuid,uuid)` on LIVE** — used by the new RLS + functions. They exist in migrations and in
   live RLS, so they should be present; the controlled dry-run will confirm before COMMIT.
6. **Min-cash flooring** — `effective_floor = floor(min_cash_x × (buy_in + rake))`. Confirm flooring
   (vs rounding) the min-cash to whole VND is acceptable (≤1 VND effect).

## Next (still owner-gated, in order)
1. Review this PR. 2. Owner gives the exact phrase → controlled dry-run → apply. 3. PR-2b Edge
   `compute-payouts` (official reads the frozen snapshot only). 4. PR-3 Prizes tab. 5. PR-4 planned
   settings. 6. PR-5 close-registration action + TV two-tier.
