# VinPoker Club Intelligence — Data Model (CI-0.x, Full Version Phase 0)

**Status:** Proposed schema — **NOT applied**. No migration exists; nothing in this file has been
created in any database. Names/types are a design target for F1–F7 (see [`ROADMAP.md`](./ROADMAP.md)).
**Companion docs:** [`FULL_VERSION_SPEC.md`](./FULL_VERSION_SPEC.md) · [`SAFETY_BOUNDARY.md`](./SAFETY_BOUNDARY.md)

> All tables are club-scoped, append-only where they record evidence, and carry provenance. Profit
> and "expected/projected" columns are forbidden on observation/derived tables (locked).

---

## 1. Modeling principles

1. **Club-scoped.** Every table has `club_id NOT NULL`; it is the basis for RLS.
2. **Staging before promotion.** Untrusted CSV lands in `club_intel_import_rows`; only validated
   rows are promoted to `club_intel_observations`.
3. **Append-only evidence.** Observations, rule runs, and report snapshots are not edited;
   corrections create a new row / dataset and supersede the old (precedent: `payroll_periods` lock,
   `payroll_audit_log`).
4. **Provenance-carrying.** Derived tables carry a `provenance` string and (where relevant) a
   version column, so every number is traceable to its source.
5. **No fabricated quantities.** No `expected_*`, `projected_*`, or `profit_*` columns on
   observations/derived tables. The single human forecast value lives only on
   `club_intel_forecasts` (a human claim being scored).

## 2. Enums

```
ci_dataset_source : 'native' | 'csv' | 'shadow'
ci_label_tier     : 'known_rule' | 'observed_pattern' | 'hypothesis'
                    | 'tested_finding' | 'model_estimate'   -- last two HOLD (reserved, not writable in F1–F8)
ci_severity       : 'info' | 'warn'
ci_run_status     : 'pending' | 'complete' | 'superseded'
```

A CHECK/app-guard restricts writes to the first three `ci_label_tier` values until the deferred
LEARNED-CAUSAL tier is opened (see [`FULL_VERSION_SPEC.md` §3–4](./FULL_VERSION_SPEC.md)).

## 3. Shared column conventions

Applied to every `club_intel_*` table:

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `club_id uuid NOT NULL` — RLS scope (FK-by-value to `clubs.id`)
- `created_by uuid` (→ `auth.users.id`), `created_at timestamptz NOT NULL DEFAULT now()`
- Immutable tables grant no UPDATE/DELETE policy; corrections supersede via a new row.

---

## 4. `club_intel_datasets`

**Purpose:** one row per ingested batch — the unit Data Readiness evaluates and everything else
attributes to. Maps a source to provenance.

| column | type | note |
|---|---|---|
| id | uuid PK | |
| club_id | uuid NOT NULL | RLS |
| source | `ci_dataset_source` | native \| csv \| shadow |
| label | text | human name (e.g. "2024 history CSV", "native Q2") |
| schema_version | text | mirrors prototype `SCHEMA_VERSION` (`club_internal_memory_v1`) |
| period_start / period_end | date | covered range |
| row_count | int | rows accepted |
| readiness_json | jsonb | cached Data-Readiness result (which analyses are supported) |
| status | text CHECK (`importing`,`ready`,`archived`) | gate |
| provenance | text | how produced |
| created_by / created_at | uuid / timestamptz | audit |

**Immutability:** `readiness_json` and `row_count` freeze once `status='ready'`; re-ingest creates a
new dataset and archives the old.

## 5. `club_intel_import_rows` (CSV staging)

**Purpose:** raw, escaped, un-promoted CSV rows — the safety boundary so malformed/injection content
never reaches observations. Mirrors prototype `loader.ts` (parse-but-don't-trust; keep row even when
a required field is missing, recording the error).

| column | type | note |
|---|---|---|
| id | uuid PK | |
| club_id | uuid NOT NULL | RLS |
| dataset_id | uuid → club_intel_datasets | batch |
| row_index | int | original line |
| raw_json | jsonb | parsed-but-unvalidated row; strings/numbers coerced; never executable |
| parse_errors | jsonb | per-field error list (kind: file/schema/row) |
| promoted | boolean DEFAULT false | true once mapped to an observation |
| created_by / created_at | | audit |

**Maps to:** CSV only. **Safety:** size 5 MB / 2000-row caps at ingest; formula-injection escaping
applied to any *export* of these rows (see [`SAFETY_BOUNDARY.md` §5](./SAFETY_BOUNDARY.md)).

## 6. `club_intel_observations` (canonical fact grain)

**Purpose:** the single normalized fact table all descriptive/pricing engines read. One row = one
tournament instance (event × slot). Source-agnostic: native and csv land here identically.

| column | type | note |
|---|---|---|
| id | uuid PK | |
| club_id | uuid NOT NULL | RLS |
| dataset_id | uuid → datasets | provenance batch |
| source | `ci_dataset_source` | native \| csv (never shadow) |
| native_tournament_id | uuid NULL | = `tournaments.id` when source=native; NULL for csv |
| occurred_on | date | event date |
| slot_time | text | time-of-day slot, `HH:MM` |
| event_name | text | event identity |
| game_type | text | from tournament |
| buy_in | numeric | X+Y total |
| prize_component | numeric | "X" |
| rake_component | numeric | "Y" |
| rake_yield_pct | numeric | `rake_component / NULLIF(buy_in,0) × 100` (observed) |
| final_entries | int | liquidity at close |
| level1_entries | int | liquidity at level 1 |
| free_rake_cap | int NULL | free-rake slot cap |
| label | `ci_label_tier` DEFAULT `observed_pattern` | descriptive grain is always Observed Pattern |
| provenance | text | adapter/import lineage |
| created_by / created_at | | audit |

> **(locked)** No `expected_*`, `projected_*`, or `profit_*` column. Cost/profit are absent by design.

**Immutability:** append-only per dataset; re-import = new dataset + new observations; old archived,
never mutated.

## 7. Native → observation adapter (F2)

A **read-only, deterministic SECURITY DEFINER read RPC** (precedent: `get_club_finance_summary`)
projects native tables into observation rows for one club. An owner-gated *materialize* action then
writes a `native` dataset + observation rows. Scope strictly by `club_id`; exclude soft-deleted.

| observation field | derived from |
|---|---|
| native_tournament_id | `tournaments.id` |
| occurred_on | `date(tournaments.start_time)` |
| slot_time | `to_char(tournaments.start_time, 'HH24:MI')` |
| event_name | `tournaments.name` |
| game_type | `tournaments.game_type` |
| buy_in | `tournaments.buy_in` |
| rake_component | `tournaments.rake_amount` |
| prize_component | `tournaments.buy_in − tournaments.rake_amount` (observed split; if `prize_pool` present, reconcile and flag any discrepancy as a data-quality rule — never override) |
| rake_yield_pct | `rake_amount / NULLIF(buy_in,0) × 100` |
| **final_entries** | `count(tournament_registrations WHERE tournament_id=t.id AND status='confirmed')` |
| **level1_entries** | `count(tournament_registrations WHERE tournament_id=t.id AND status='committed')` |
| free_rake_cap | tournament free-rake config (when enabled) |
| settlement cross-check | `leaderboard_entries` (winnings/cashout by `club_id`+`entry_date`) used **only** for a data-quality reconciliation rule — **never** to compute profit |

**Variant:** clubs using `stack_registrations` map confirmed entries via the same status logic.
**(locked):** `leaderboard_entries` is reconciliation-only; the adapter computes no profit.

## 8. `club_intel_forecasts` (human shadow entries)

**Purpose:** stores HUMAN forecasts so the Shadow Lab can compute discipline vs actual.
The system never produces these numbers.

| column | type | note |
|---|---|---|
| id | uuid PK | |
| club_id / dataset_id | uuid | RLS + batch (source=shadow) |
| target_event / target_slot / target_date | text/text/date | what was forecast |
| forecast_metric | text CHECK (`final_entries`,`level1_entries`) | which metric |
| forecast_value | numeric | the human's entry |
| actual_value | numeric NULL | filled from a matching observation — not predicted |
| entered_by / entered_at | uuid / timestamptz | human author + time (discipline needs author) |
| created_by / created_at | | audit |

> `forecast_value` is the ONLY place a number like "expected entries" may legally exist, because it
> is explicitly a human claim being scored — not a system output (locked).

## 9. `club_intel_rule_runs` (immutable)

**Purpose:** one immutable record per rules-engine evaluation.

| column | type | note |
|---|---|---|
| id | uuid PK | |
| club_id / dataset_id | uuid | RLS + input batch |
| rule_set_version | text | which declarative rule set |
| facts_json | jsonb | the flat Facts the evaluator saw (replayable) |
| findings_json | jsonb | `[{id,type,label,severity,message,provenance,killed}]` |
| status | `ci_run_status` | complete \| superseded |
| created_by / created_at | | audit |

**Immutability:** no UPDATE/DELETE; a re-run inserts a new row and marks the prior `superseded`.
Deterministic: same `facts_json` + `rule_set_version` ⇒ identical `findings_json`.

## 10. `club_intel_report_snapshots` (immutable, lockable)

**Purpose:** the Owner Report briefing frozen at a point in time (3 opportunities / 3 risks /
weekly draft), re-expressing engine output only.

| column | type | note |
|---|---|---|
| id | uuid PK | |
| club_id | uuid NOT NULL | RLS |
| dataset_id / rule_run_id | uuid | inputs it re-expresses |
| report_json | jsonb | the briefing payload (labeled findings only) |
| status | text CHECK (`draft`,`locked`) | precedent: `payroll_periods.status` |
| locked_at / locked_by | timestamptz / uuid | precedent: `approved_at`/`approved_by` |
| created_by / created_at | | audit |

**Immutability:** once `status='locked'`, any write RPC raises an EXCEPTION (payroll lock precedent).
A new report is a new snapshot.

## 11. `club_intel_audit_log`

**Purpose:** change trail, modeled exactly on `payroll_audit_log`.

| column | type | note |
|---|---|---|
| id | uuid PK | |
| club_id | uuid | scope |
| table_name | text | which CI table |
| record_id | uuid | affected row |
| action | text CHECK (`INSERT`,`UPDATE`,`DELETE`) | |
| old_values / new_values | jsonb | before/after |
| changed_by | uuid → auth.users | actor (`auth.uid()`, fallback GUC) |
| changed_at | timestamptz DEFAULT now() | |
| reason | text NULL | optional |

Populated by a SECURITY DEFINER trigger `fn_ci_audit_trigger` (mirrors `fn_audit_trigger`),
attached to datasets, forecasts, rule_runs, report_snapshots.

## 12. Entity relationship & grain

```
clubs (owner_id)
  └─ club_intel_datasets (source)
       ├─ club_intel_import_rows      [csv staging]   → promote →
       ├─ club_intel_observations     [grain: 1 = event×slot tournament instance]
       └─ club_intel_forecasts        [shadow, human]
  club_intel_rule_runs        → reads observations (+ derived facts)   [immutable]
  club_intel_report_snapshots → re-expresses a rule_run                [immutable/lockable]
  club_intel_audit_log        → trails all of the above
```

- **Grain statement:** `club_intel_observations` is the atomic fact (one tournament instance).
  Descriptive, pricing, rules, schedule, and shadow all derive from this grain — never from
  fabricated values.
