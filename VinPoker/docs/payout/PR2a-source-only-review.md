# PR-2a — Payout "Engine 3-neo" backend · SOURCE-ONLY review report

> **STATUS: SOURCE-ONLY. NOT APPLIED.** No `supabase db push`, no `schema_migrations` write, no Edge
> deploy, no production DB touched, no live DB connection opened (the parse ran offline via WASM).
> Applied later ONLY via the owner-approved controlled Management-API runbook (preflight → dry-run
> `BEGIN…ROLLBACK` → exact owner phrase → `BEGIN…COMMIT` → verify). **GO for review + controlled
> dry-run. NO-GO for production apply** until an explicit, specific owner approval phrase (not a
> generic "OK").

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
| `assert_tournament_registration_open()` + `trg_entries_registration_open` | trigger fn + **BEFORE INSERT OR UPDATE** trigger | the close-guard (see below) |
| `prepare_payout_snapshot(...)` | fn (DEFINER) | lock + terminal close + freeze snapshot; **never supersedes** |
| `apply_payout_run(...)` | fn (DEFINER) | re-verify invariants + write official payout; supersede only here |
| `save_tournament_prizes_v2(...)` | fn (DEFINER) | guarded manual edit → new applied run superseding old |

`update_tournament_prizes` / `get_tournament_prizes` are **kept untouched** (old manual panel still
works while `payoutEngine` flag is OFF).

## Close-guard — entry "drift after close" is blocked in BOTH directions
A single `BEFORE INSERT OR UPDATE` trigger on `tournament_entries` is the choke point (no live cashier
RPC is edited → no regression risk). After `registration_closed_at IS NOT NULL`:

1. **INSERT** → rejected (`REGISTRATION_CLOSED`). Covers every writer found by
   `grep "INSERT INTO tournament_entries"` on origin/main:
   `confirm_registration_and_assign_seat` (20260807000001 / 20260811000000),
   `create_offline_buyin_and_seat` (20260826000002 / 3), `reenter_tournament_player` /
   `add_player_with_reentry` (20260901000001), `floor_assign_player_to_seat` (20260913000000),
   `seat_day2_qualifiers` (20261027000000; also blocked at prepare by `MULTIDAY_UNSUPPORTED`),
   the seed (20260825000001), and any future/direct INSERT.
2. **UPDATE** → rejected only when it **revives** a non-counted entry into the counted set, i.e.
   `OLD.status ∈ {void,voided,cancelled,canceled,refunded,rejected}` AND `NEW.status ∉` that set.
   Legitimate post-close updates (seat move, bust, re-cancel) pass.
3. **`UPDATE tournament_registrations SET status='confirmed'`** — the official count reads
   `tournament_entries`, NOT registrations, so a confirmed registration alone cannot drift the count;
   and the confirm flows (`confirm_registration_and_assign_seat`, `dealer_self_service_rpcs`) confirm
   *together with* a guarded entry INSERT, which fails after close → the whole txn rolls back.

**Grep results documented (origin/main):**
- `UPDATE tournament_entries` writers: confirm/move-seat/offline-seat/void(→`cancelled`)/close-table/
  redraw/day2-seat — all either set `seat_id`/move/bust or **cancel** (count-decreasing); **none**
  un-cancel. `grep -i "unvoid|reactivat|reinstate|restore_entry"` on `tournament_entries` → **none**.
- `UPDATE tournament_registrations SET status='confirmed'` → only inside the entry-INSERT confirm
  flows (so INSERT-guarded). Conclusion: **no path raises the official entry count after close**; the
  BEFORE UPDATE arm is future-proofing.

## Trigger race proof (lock ordering)
The trigger reads the parent tournament with `FOR SHARE`; `prepare_payout_snapshot` locks it with
`FOR UPDATE`. `FOR SHARE` and `FOR UPDATE` **conflict**, so the two serialise:
- **insert before close** → the insert's `FOR SHARE` is taken/committed first; `prepare`'s `FOR
  UPDATE` then waits, and the subsequent `count(*)` **includes** that entry.
- **close before insert** → `prepare` holds `FOR UPDATE`, sets `registration_closed_at`, commits;
  the later insert's trigger reads the committed flag and **rejects**.
- **concurrent insert ↔ prepare** → cannot interleave into an *uncounted paid entry*: whoever takes
  the lock first wins; the other waits and then is either counted (insert-first) or rejected
  (prepare-first). Multiple concurrent inserts share `FOR SHARE` (no mutual block); only `prepare`
  serialises against them. (True multi-session concurrency is hard to exercise in the SQL Editor —
  this is the lock-ordering argument; the dry-run covers the single-session before/after behaviour.)

## Invariants `apply_payout_run` re-checks (last line of defence)
`prize_pool == prize_pool_snapshot`; `Σ amount == prize_pool_snapshot` (NOT `entries×buyIn`);
positions `1..N` contiguous, no gap/dup; `amount ≥ 0`; monotone non-increasing; `itm_places == row
count`; `effective_floor ∈ [0, pool]`; **min-cash**: `N≥2 & not POOL_BELOW_MIN_CASH ⇒ last ==
effective_floor`, `N=1 ⇒ last == pool`; **`max(amount) ≤ 9,999,999,999.99`** →
`PAYOUT_AMOUNT_EXCEEDS_COLUMN_LIMIT` (clear error instead of a cryptic NUMERIC(12,2) overflow).
`percentage` is recomputed server-side, never trusted.

## Idempotency / concurrency (P0-1) + transaction ordering
- Two concurrent `prepare` → resume the **same draft** (no duplicate); two concurrent `apply` → one
  applied, the second fails cleanly on `uq_payout_applied`.
- `regenerate` keeps the old `applied` run + `tournament_prizes` until the new `apply` succeeds —
  **supersede happens only inside `apply_payout_run`**, so an Edge/apply crash never destroys the live payout.
- **`apply_payout_run` order:** lock → role check → still-closed → **validate all invariants** →
  (only now) `DELETE`+`INSERT tournament_prizes` → `UPDATE tournaments(prize_pool,itm_places)` →
  supersede old applied → mark this run applied. The supersede-then-mark order keeps **exactly one
  applied row at every step** (never two → never violates the unique index).
- **`save_tournament_prizes_v2` order (manual edit):** lock → reason required → role check →
  still-closed → find current applied (must exist) → **validate rows first** (Σ==locked pool,
  contiguous, ≥0, monotone, amount-cap) → `DELETE`+`INSERT tournament_prizes` →
  `UPDATE tournaments(itm_places)` (pool unchanged) → **supersede old applied** → **insert new
  applied (`source='manual_edit'`)**. The old applied is superseded **only after** validation passes,
  and superseded **before** the new applied is inserted (again ≤1 applied at all times).

## Verification performed (local, no DB)
- **Real Postgres-grammar parse** (`pgsql-parser` / libpg_query WASM, isolated install in scratchpad):
  `PARSE_OK` for both files, zero syntax errors.
- `$$` delimiters balanced; GRANT/REVOKE signatures match each function's arg list.
- The embedded dry-run now also runs a **preflight** (`is_club_*(uuid,uuid)` present), object
  existence, `is_tournament_registration_closed(unknown)=false`, write-function early guards, and the
  row-invariant SQL on good/gap/inversion sets — **to be executed in the controlled dry-run txn**.

## Corrected test wording (the close model)
`prepare_payout_snapshot` **IS** the "close registration" action: on an *open* tournament it sets
`registration_closed_at` and creates the draft snapshot (it does NOT reject an open tournament). The
reject cases are:
- `apply_payout_run` with no valid `draft_snapshot` run / not-closed → reject
  (`RUN_NOT_FOUND` / `RUN_NOT_DRAFT` / `REGISTRATION_NOT_CLOSED`).
- a second `apply` for an already-applied tournament → reject via `uq_payout_applied`.
(So: NOT "prepare before close rejects" — prepare *performs* the close.)

## Live-helper preflight (standalone, read-only — run before the controlled apply)
```sql
SELECT oid::regprocedure
FROM   pg_proc
WHERE  proname IN ('is_club_owner','is_club_admin','is_club_cashier')
ORDER  BY 1;
-- Expect exactly the three (uuid,uuid) signatures. The dry-run's section 0 also asserts this.
-- (is_club_floor is intentionally NOT required — it/`club_floors` are absent on live; see below.)
```

## DB / deploy safety — proof
- `git diff --cached` for this branch shows only the source files (migration + dry-run + this doc).
- **No** `supabase db push` / `migration up` / `db reset` / `deploy_db`. `schema_migrations` **not**
  written. **No** Edge deployed. **No** live DB connection (parse ran offline via WASM). No secrets printed.

## Owner questions — status
RESOLVED this round:
1. **Finalize permission** → **Owner/Admin/Cashier** (the controlled dry-run found `is_club_floor` /
   `club_floors` absent on the live DB, so `is_club_floor` was removed from PR-2a; floor-specific
   payout permission, if ever needed, is a separate role-system PR after `club_floors` exists live —
   meanwhile give that user the cashier/admin role). ✔
2. **Manual-edit monotonicity** → enforced monotone non-increasing (kept). ✔
3. **Void entry counting** → count `tournament_entries` excluding cancelled/void statuses; void sets
   `status='cancelled'` (confirmed via `void_registration`), so the exclusion is correct. Final value
   re-confirmed in the controlled dry-run + UAT. ✔

STILL OPEN (no code change needed; verified at controlled apply):
4. **`tournament_prizes.amount NUMERIC(12,2)`** (~10^10 VND ceiling) is a pre-existing schema limit.
   Handled now by `PAYOUT_AMOUNT_EXCEEDS_COLUMN_LIMIT` (fails loudly). A later migration may widen it
   to `NUMERIC(18,2)`/BIGINT if a single payout could exceed ~10 billion VND.
5. **`is_club_*(uuid,uuid)` on LIVE** → **RESOLVED by the dry-run.** Live has
   `is_club_owner/admin/cashier(uuid,uuid)` but **not** `is_club_floor` (nor its `club_floors` table).
   PR-2a now gates **Owner/Admin/Cashier only**; floor is intentionally out of scope. ✔
6. **Min-cash flooring** — `effective_floor = floor(min_cash_x × (buy_in + rake))` (whole VND, ≤1 VND
   effect). Confirm flooring (vs rounding) is acceptable.

## Next (still owner-gated, in order)
1. Owner reviews this PR + the migration diff. 2. Controlled **dry-run** `BEGIN…ROLLBACK` (preflight +
   the companion). 3. If dry-run passes → owner gives the **specific** approval phrase → controlled
   apply (`BEGIN…COMMIT`) → verify. 4. PR-2b Edge `compute-payouts` (official reads the frozen
   snapshot only). 5. PR-3 Prizes tab. 6. PR-4 planned settings. 7. PR-5 close-reg action + TV two-tier.
