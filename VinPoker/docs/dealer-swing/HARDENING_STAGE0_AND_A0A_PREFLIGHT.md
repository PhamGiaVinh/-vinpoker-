# Dealer Swing Hardening — Stage 0 Design Gate + A0a Data-Sufficiency Preflight

> Status: **DESIGN GATE — no code, no DB writes.** Source-only document.
> Roadmap: see the approved execution contract (Stage 0 → A0 → A1 → C1 → A2 → A3 → B2 → C2 →
> B1 → C3 → D1 → B3 → D2). This doc closes Stage 0 and delivers the structural half of A0a.

## 0. Why this exists

A CTO-level review proposed a replay/simulation harness (A0) as the gate for every later
scorer change. The reviewer correctly warned: **do not assume the harness is feasible until we
prove the historical data can reconstruct what the scorer saw.** This doc does that proof
(structural half, from schema + code), freezes the baseline-metric query set, and surfaces the
two owner decisions that unblock A2 and B2.

## 1. A0a — Data-sufficiency verdict (structural, from live schema + `pickNextDealer.ts`)

`buildDealerCandidates` consumes this decision-time state (verified `pickNextDealer.ts:236-468`):
active dealers; `dealer_attendance` (current_state, worked_minutes_since_last_break,
priority_break_flag, check_in_time, last_released_at, pool_entered_at); `dealer_shift_metrics`
(minutes_since_rest, total_assignments, total_break_minutes, total_worked_minutes); last-2
assignments per dealer (back-to-back / tour_tier); active `dealer_breaks`; busy cross-checks on
`dealer_assignments`; shortage/overdue/emergency context; table tier + skills.

What history actually persists:
- `swing_audit_logs` (`types.ts:4545`): **outcome only** — action, assignment_id, club_id,
  created_at, details(JSON), error_message, new/old_dealer_id, shift_id, table_id, triggered_by.
  It records WHO swung in/out at a table and the reason — **not the candidate pool the scorer saw.**
- `dealer_assignments`: append rows with assigned_at / swing_due_at / released_at / status /
  version → the **assignment timeline is preserved**.
- `dealer_shift_metrics`: a **live VIEW** (`types.ts:6086`, no Insert/Update) computed at query
  time → **no history**.
- `dealer_attendance` / `dealer_breaks`: **mutated in place** → decision-time values (priority_break_flag,
  pool_entered_at, minutes_since_rest at that instant) are **overwritten, not snapshotted**.
- The per-candidate `ScoreBreakdown` and `diag` reject counters are **computed and discarded** —
  never written anywhere.

### Verdict table

| Scorer input / KPI | Reconstructable? | Fidelity | Source |
|---|---|---|---|
| Swing outcomes (who in/out, table, time, reason) | YES | **EXACT** | `swing_audit_logs` + `dealer_assignments` |
| Overdue minutes per table (due → actual relief) | YES | **EXACT-ish** | `dealer_assignments` (swing_due_at, released_at) |
| Manual-override rate (manual vs cron) | YES | **PROXY (good)** | `swing_audit_logs.triggered_by` |
| Per-dealer rest gaps (released_at → next assigned_at) | YES | **PROXY** | `dealer_assignments` timeline |
| **`race_lost` rate** | **NO** | — | canonical `perform_swing` returns BEFORE the audit INSERT → no row written (verified) |
| Decision-time candidate pool (available/on_break set) | NO | — | `dealer_attendance` mutated in place, no snapshot |
| `priority_break_flag` / `pool_entered_at` at decision instant | NO | — | mutated in place |
| Per-candidate `ScoreBreakdown` the scorer produced | NO | — | computed + discarded |

### A0a conclusion (this changes A0/A2)

**Faithful historical *scorer* replay is LOW-fidelity by construction** — the inputs the scorer
evaluated each tick are not event-sourced. Therefore A0 must split into three modes, and A2's
acceptance must lean on the trustworthy ones:

1. **Outcome-replay (TRUSTWORTHY).** Reconstruct the assignment/swing timeline from
   `dealer_assignments` + `swing_audit_logs` and compute the EXACT/PROXY KPIs above (overdue
   minutes, swing counts, manual-override rate, per-dealer fairness gaps). This is the baseline
   A2 is measured against. **race_lost rate is excluded** (not reconstructable) unless C3 adds it.
2. **Synthetic-scenario harness (DETERMINISTIC).** Validate scorer *changes* with hand-built pool
   states — the pattern already in `pickNextDealer` unit tests (regression tests #9, #10). This is
   how A2 proves "no regression on edge cases," since real decision-time pools are unrecoverable.
3. **Forward decision-trace persistence (FUTURE high-fidelity).** Persist the `diag` + per-candidate
   `ScoreBreakdown` per tick (this is exactly what C1 surfaces and C3 records). Once live, future
   scorer work gets true historical replay. **Recommendation: pull a thin "persist decision trace"
   slice forward into C1/C3 so A2-future is replayable.**

**Impact on A2 acceptance (supersedes "identical non-edge output"):** exact-match on a LOCKED
synthetic golden subset; outcome-KPI deltas (mode 1) within an accepted envelope; every changed
outcome explained by an explicit policy diff. We do NOT claim faithful per-tick historical replay.

## 2. Baseline-metric freeze — query set (READ-ONLY; owner-authorized run)

Run over the last 7–30 days, per club, **read-only** (no writes, no schema change). Owner either
authorizes a read-only `supabase-ops` run or pastes results back. These freeze the "before" numbers.

1. **Overdue exposure:** from `dealer_assignments` where status='completed' and swing_due_at not
   null — `avg/max/p90 (released_at - swing_due_at)` filtered to positive; count of swings released
   > 5 / > 15 min late, grouped by day + club.
2. **Swing volume + mix:** `swing_audit_logs` action counts per day/club (swing_success vs
   swing_no_dealer); ratio of `triggered_by` = manual/floor vs `process-swing` (manual-override rate).
3. **Fairness spread:** per dealer per day, total assigned minutes (Σ released_at − assigned_at) and
   number of sessions → Gini/stdev across the active roster (rest-debt proxy).
4. **Pre-announce reliability:** `pre_announce_jobs` counts by status (sent/failed/pending) + retry
   distribution (this path IS event-sourced).
5. **Lock health (for B2 baseline):** `club_processing_locks` current rows + age; if any audit/log
   of reclaim exists, count lease-overrun reclaims (else note "not currently observable" → C2/C3).

> NOTE: `race_lost` rate is intentionally absent — not reconstructable today (see §1). It becomes
> measurable only after C3 adds it to the audit/metrics path.

## 3. Owner decision 1 — is `priority_break_flag` HARD or SOFT? (drives A2)

Today it is **both, sequentially** (`pickNextDealer.ts:704-709` hard rest-gate when rest<25min,
then `:843-846` a flat **−500** soft penalty). The −500 acts as a near-veto in practice.

- **Option A — HARD safety gate (recommended).** A flagged dealer is excluded until rested ≥
  threshold; emergency override (`skipPriorityBreakGuard`) is the only bypass and must log a reason.
  Drop the −500 (redundant once it's a clean gate). Clearest to reason about; matches "rest is a
  health/fairness guarantee."
- **Option B — SOFT preference.** Remove the hard rest-gate; keep a *tunable* penalty (not a flat
  −500 veto) so a flagged dealer can still be picked under shortage without an emergency flag.
  More flexible, but blurs "must rest" vs "prefer not."

A2 cannot start until this is locked.

## 4. Owner decision 2 — lease strategy (drives B2)

The 120s table-lease (`try_acquire_club_lock`) is reclaimed by the next tick if a run overruns →
two concurrent `process-swing` runners.

- **Option A — heartbeat-extend with fencing (recommended).** The run periodically extends its
  lease and carries an owner token/version; every state-changing pass acts ONLY while it is still
  the valid owner; reclaim events are logged. Robust against long-but-healthy runs.
- **Option B — hard-cap per-tick work.** Bound each tick so a run cannot exceed the lease; define
  which pass may stop mid-way, the safe stop boundary, and the resume invariant. Simpler, but risks
  starving late passes under load.

B2 cannot start until this is locked.

## 5. Stage-0 exit / next gate

Stage 0 is closed when the owner (1) authorizes/returns the §2 baseline read, (2) picks Decision 1,
(3) picks Decision 2. Then A0 proceeds as: outcome-replay KPIs (mode 1) + synthetic harness (mode 2)
+ a thin forward decision-trace slice (mode 3, folded into C1/C3). No scorer code (A2) is touched
until A0 baseline + Decision 1 are locked and C1 has shipped.
