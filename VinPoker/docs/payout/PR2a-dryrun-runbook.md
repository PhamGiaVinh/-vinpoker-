# PR-2a — Controlled DRY-RUN runbook (package)

> **PREPARED, NOT RUN.** This document + the three SQL files are the dry-run *package*. Nothing in it
> has been executed against the production DB. The dry-run is `BEGIN…ROLLBACK` (writes nothing); it is
> still run **only inside the owner-approved controlled session**. **There is NO COMMIT/apply step
> here** — production apply is a separate phase requiring a specific explicit owner approval phrase
> (not a generic "OK"). The deny-first safety hook stays enabled throughout.

## Files in the package
| File | Role | Self-wrapped txn? |
|---|---|---|
| `migrations/20261120000000_payout_engine.sql` | the migration (DDL + functions + trigger + RLS) | no (raw DDL) |
| `migrations/_payout_engine_20261120_dryrun.sql` | structural + preflight + logic asserts | yes (`BEGIN…ROLLBACK`) |
| `migrations/_payout_engine_20261120_functional.sql` | fixture-based trigger / auth / happy-path / invariant tests | yes (`BEGIN…ROLLBACK`) |

## How the controlled session runs it (two equivalent modes)

**Mode A — combined pre-apply dry-run (recommended): migration + all asserts in ONE rolled-back txn.**
Assemble one statement (strip the assert files' own `BEGIN;`/`ROLLBACK;` so the whole thing is one txn):
```bash
{ echo "BEGIN;";
  cat 20261120000000_payout_engine.sql;
  sed '/^BEGIN;[[:space:]]*$/d;/^ROLLBACK;[[:space:]]*$/d' _payout_engine_20261120_dryrun.sql;
  sed '/^BEGIN;[[:space:]]*$/d;/^ROLLBACK;[[:space:]]*$/d' _payout_engine_20261120_functional.sql;
  echo "ROLLBACK;";
} > dryrun_combined.sql
# → POST dryrun_combined.sql to the Management API /database/query (single statement).
```
This proves the migration **applies cleanly** (creates every object, catches missing live deps / FK /
type issues at apply time) **and** that the objects behave correctly — then discards everything.

**Mode B — post-apply verification:** after a real apply, run each assert file **standalone** (each
already wraps `BEGIN…ROLLBACK`) to verify the live objects. Same expected output.

A `ROLLBACK` ends every path — **no COMMIT anywhere in this package**.

---

## (1) Preflight — read-only, run first (anytime)
```sql
SELECT oid::regprocedure
FROM   pg_proc
WHERE  proname IN ('is_club_owner','is_club_admin','is_club_cashier')
ORDER  BY 1;
```
**Expected (PASS):** exactly these three rows —
```
is_club_admin(uuid,uuid)
is_club_cashier(uuid,uuid)
is_club_owner(uuid,uuid)
```
**FAIL:** any missing / a different signature → STOP. The migration's RLS + functions depend on
`is_club_owner/admin/cashier(uuid,uuid)`; a mismatch would only surface at runtime, so it must be
confirmed before apply. (The structural dry-run's section 0 re-asserts this inside the txn.)
**Note:** `is_club_floor` is intentionally NOT required — the first dry-run found it (and `club_floors`)
absent on the live DB, so PR-2a gates **Owner/Admin/Cashier only**.

## (2) Structural dry-run — `_payout_engine_20261120_dryrun.sql`
Runs without auth/data. **Expected NOTICEs, in order (PASS):**
| Step | NOTICE | Asserts |
|---|---|---|
| 0 | `OK 0 — is_club_owner/admin/cashier(uuid,uuid) all present` | live role helpers exist |
| 1 | `OK 1/4 — all objects present` | 5 columns, 2 tables, `uq_payout_applied`, 5 functions, trigger, RLS policies |
| 2 | `OK 2/4 — is_tournament_registration_closed(unknown)=false` | closed-helper returns false for an unknown id |
| 3 | `OK 3/4 — write-function guards fire (parse + early checks)` | prepare/apply/save raise `AUTH_REQUIRED`/`*_NOT_FOUND`/`MANUAL_EDIT_REASON_REQUIRED` |
| 4 | `OK 4/4 — row-invariant SQL detects good / gap / inversion correctly` | the apply/save validation CTE logic |

**FAIL:** any `DRYRUN_FAIL: …` EXCEPTION names the exact missing/wrong object or logic. Nothing persists.

## (3) Functional dry-run — `_payout_engine_20261120_functional.sql`
Builds a throwaway fixture (synthetic club owned by a **real** `auth.users` id; 2 tournaments; entries;
all rolled back) and exercises real behaviour. **Expected NOTICEs, in order (PASS):**

### Trigger guard (tour1 — no auth needed)
| Step | NOTICE | What it proves |
|---|---|---|
| T1 | `T1 OK — 11 inserts while OPEN (10 counted + 1 cancelled)` | inserts allowed while registration open |
| T2 | `T2 OK — insert after close blocked` | `BEFORE INSERT` rejects new entry after `registration_closed_at` |
| T3 | `T3 OK — reviving a cancelled entry after close blocked` | `BEFORE UPDATE` blocks `cancelled → registered` (revive) after close |
| T4 | `T4 OK — legitimate post-close update (bust) allowed` | non-revive updates (bust) still pass after close |

### Auth gate + happy path + invariants (tour2 — needs `auth.uid()` driven via GUC)
| Step | NOTICE | What it proves |
|---|---|---|
| A1 | `A1 OK — non-owner prepare rejected (NOT_AUTHORIZED)` | a non-owner principal cannot finalize |
| P1 | `P1 OK — prepared (pool=10,000,000 floor=2,400,000), registration closed` | prepare **is** the close action; snapshot = 10×buy_in, floor=2×(buy_in+rake) |
| AP1 | `AP1 OK — official payout written (2 prizes, pool+itm set, exactly 1 applied run)` | apply writes `tournament_prizes` + `tournaments.prize_pool`/`itm_places`; one applied run |
| AP2 | `AP2 OK — re-applying an applied run rejected` | `RUN_NOT_DRAFT` (single-applied) |
| INV1 | `INV1 OK — sum mismatch rejected` | DB invariant guard (`SUM_MISMATCH`) |
| INV1b | `INV1b OK — old applied payout survived the failed regenerate` | **supersede only on success** — a failed regenerate never destroys the live payout |
| — | `FUNCTIONAL DRY-RUN PASS — …` | all of the above |

**FAIL:** any `FUNC_FAIL …` EXCEPTION = a real defect (named). **Env note:** if this session cannot
drive `auth.uid()` via GUC, you'll see `T1–T4 OK` then a SKIP note for A1/P1/AP*/INV* — re-verify those
via an authenticated app session (an admin clicking "Đóng đăng ký & tạo payout" on a test tournament).
Nothing persists either way.

## (4) RLS test expectations
The new tables write **deny-direct** (no INSERT/UPDATE/DELETE policy → only the `SECURITY DEFINER`
functions, which the table owner runs, can write). Reads are role-scoped. Verify in the controlled
session **as an authenticated principal** (app session or `SET LOCAL ROLE authenticated` + JWT claims):
| Principal | Action | Expected |
|---|---|---|
| club owner/admin/cashier | `SELECT * FROM tournament_payout_runs` (their club) | rows visible |
| outsider (not in the club) | `SELECT * FROM tournament_payout_runs` | **0 rows** (RLS) |
| any authenticated | `INSERT INTO tournament_payout_runs …` directly | **denied** (no write policy) |
| any authenticated | `UPDATE tournament_payout_runs …` directly | **denied** |
| club owner/admin | `INSERT INTO payout_templates …` | allowed |
| cashier | `INSERT INTO payout_templates …` | **denied** (read-only) |
| outsider | `SELECT * FROM payout_templates` | **0 rows** |
The functional dry-run's **A1** (non-owner `NOT_AUTHORIZED`) already proves the function-level role gate
that mirrors this; the table-level checks above are the RLS layer.

## (5) Trigger guard test expectations
Summarised from §(3) trigger steps — after `registration_closed_at IS NOT NULL`:
- INSERT into `tournament_entries` → `REGISTRATION_CLOSED` (covers confirm / re-entry / offline buy-in /
  floor-assign / day2 / direct — all go through this one trigger).
- UPDATE that revives `cancelled/void → counted` → `REGISTRATION_CLOSED`.
- UPDATE that does not revive (seat move, bust, re-cancel) → allowed.
- While open → everything allowed.
Lock ordering (`FOR SHARE` in the trigger vs `FOR UPDATE` in `prepare`) guarantees no uncounted paid
entry can slip in concurrently (see the review doc's race-proof section).

## (6) No COMMIT — and what comes after
This package contains **no COMMIT**. Sequence from here:
1. Owner reviews PR #580 + this runbook.
2. Controlled session runs Mode A (`BEGIN…ROLLBACK`) → expects all NOTICEs above, no `*_FAIL`.
3. **Report dry-run result and STOP.**
4. Production apply is a **separate** step — it needs a specific explicit owner approval phrase; only
   then is the migration re-sent as `BEGIN; <migration>; COMMIT;` (schema_migrations still NOT written),
   followed by post-apply verification (Mode B + the preflight). No Edge deploy until PR-2b.
