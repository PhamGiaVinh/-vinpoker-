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

**✅ LOCKED — Option A: HARD safety gate.** A flagged dealer is excluded until rested ≥ threshold;
the only bypass is the emergency `skipPriorityBreakGuard` (which must log a reason); the redundant
−500 soft penalty is dropped once the gate is clean. Rationale: "rest is a health/fairness
guarantee," clearest to reason about. A2 implements `priority_break_flag` as a tier-1 (safety/
impossibility) hard filter in the lexicographic objective, NOT a soft score term.

## 4. Owner decision 2 — lease strategy (drives B2)

The 120s table-lease (`try_acquire_club_lock`) is reclaimed by the next tick if a run overruns →
two concurrent `process-swing` runners.

**✅ LOCKED — Option A: heartbeat-extend with fencing.** The run periodically extends its lease and
carries an owner token/version; every state-changing pass acts ONLY while it is still the valid
owner; reclaim events are logged/metered. Robust against long-but-healthy runs. B2 must add the
owner-token/version column to `club_processing_locks`, a heartbeat-extend RPC, and an
ownership-check guard at the top of every state-changing pass (source-only first, then controlled apply).

## 5. Stage-0 exit / next gate

- ✅ Decision 1 LOCKED (HARD), Decision 2 LOCKED (heartbeat-extend + fencing) — see §3, §4.
- ⏳ Baseline read: owner chose "agent runs read-only." Realized SECURELY via a read-only probe
  workflow using the GitHub Secret `SUPABASEACCESSTOKEN` (owner triggers from the Actions tab) —
  **NOT** via a chat-pasted token. The `sbp_` value the owner pasted in chat + the plaintext repo
  Variable `SUPABASEACCESTOKEN` must be **rotated** and the variable moved to a Secret.

Next: A0 proceeds as outcome-replay KPIs (mode 1, after the baseline probe runs) + synthetic
harness (mode 2) + a thin forward decision-trace slice (mode 3, folded into C1/C3). No scorer code
(A2) is touched until the A0 baseline is captured, Decision 1 is locked (done), and C1 has shipped.

## 6. FROZEN BASELINE (probe run 2026-06-18) + fidelity corrections

Baseline probe (`scripts/diagnostics/dealer_swing_baseline_probe.mjs`, PR #340) ran read-only over
the last 30 days. Headline + the corrections it forced on A0a.

### 6.1 Headline — the system is now in a HEALTHY regime

Overdue exposure (club `22222222`, completed swings with `swing_due_at`):

| Day | Completed swings | avg overdue when late | max overdue | late >5min | late >15min |
|---|---|---|---|---|---|
| 06-18 | 443 | 1.1m | 25.0m | 14 | 3 |
| 06-17 | 272 | 0.8m | 6.0m | 3 | 0 |
| 06-16 | 443 | 0.7m | 1.1m | 0 | 0 |
| 06-15 | 684 | 2.3m | 66.1m | 64 | 18 |
| 06-13 | 454 | 10.6m | 31.1m | 160 | 150 |
| 06-09 | 629 | 23.3m | 31.0m | 89 | 74 |
| 06-06 | 155 | 59.0m | 61.1m | 12 | 12 |
| 06-05 | 195 | **3390m** | **8232m** | 167 | 160 |
| 06-01..04 | — | 65–340m | 380–2013m | high | high |

Recent stable window (06-16→06-18): 1158 swings, only **3 late >15min (0.26%)**, max overdue ≤25m.
The chaotic tail (early June: avg-overdue in the hundreds–thousands of minutes, max 8232m) is the
**pre-rotation-scheduler + orphan-freeze era** — exactly the class fixed by #299/#312/#314/#317 +
the forward scheduler. **Baseline for A2 must be anchored on the post-fix stable window, not the
pre-fix tail** (else any change looks like a massive improvement for the wrong reason).

### 6.2 Three fidelity corrections (these change A0b/A2 plumbing)

1. **`swing_audit_logs` is SPARSE and uses different `action` labels than assumed.** Logged
   actions/day = 1–123 while `dealer_assignments` completed/day = 234–684 → the audit log captures
   only a fraction of swings, and `action='swing_success'`/`'swing_no_dealer'` matched **0 rows**
   (the real labels differ). → **Outcome-replay swing VOLUME must come from `dealer_assignments`
   (the complete record), NOT `swing_audit_logs`.** The probe must be re-run with a `distinct
   action` query to learn the real labels.
2. **Manual-override rate IS classifiable** via `triggered_by`: auto = `system` (415) + `system_trigger`
   (21) = 436; manual = two operator UUIDs `6c320d89…` (96, =vbacker) + `e7066175…` (6, =athena) =
   102. Logged-event manual share ≈ **19%** (proxy only — audit log is sparse).
3. **Fairness query was polluted by un-released rows.** `coalesce(released_at, now())` produced
   impossible ~40,000-min "sessions" on orphan-era days (06-09→06-12) because never-released
   assignments count to `now()`. Clean recent days: avg ~460–510 min/dealer, stddev ~195–233
   (CV ~40%). → **Fairness reconstruction must filter `released_at IS NOT NULL` (completed sessions)
   and/or cap session length.**

Also: `pre_announce_jobs` and `club_processing_locks` queries returned `[]` — pre_announce likely
uses a different timestamp column (or rows are deleted post-send), and locks are transient (empty at
the probe instant). The empty `club_processing_locks` confirms **no reclaim history exists today →
B2 must ADD reclaim observability**, it cannot be baselined from current data.

### 6.3 Baseline status — ✅ FROZEN (corrected re-run 2026-06-18)

The corrected probe re-ran clean. A0 baseline is now complete:

- **Overdue exposure (EXACT, from `dealer_assignments`):** post-fix stable-window target =
  late>15min ≈ **0.26%**, max overdue **≤25m** (06-16→06-18, 1158 swings).
- **Real `swing_audit_logs` action labels (30d):** `late_checkin` 147, `swung` 145,
  `swing_executed` 123, `table_closed` 99, `recalc_swing_due_at` 21, `tour_closed` 3. Only
  `swung`+`swing_executed` (268) are swing events — **vs thousands of `dealer_assignments`
  completions → audit log logs only a SUBSET of swing paths. Confirmed: use `dealer_assignments`
  for swing volume.** Manual vs auto: `system`(415)+`system_trigger`(21) auto; two operator UUIDs
  (102) manual ≈ **19%** of logged events.
- **Fairness spread (clean, `released_at IS NOT NULL` + 600m cap):** recent days avg ~460–510
  min/dealer, stddev ~195–233 → **CV ≈ 40–50%** (meaningful per-dealer daily-load spread → real
  signal for A2/A3 fairness-debt). The orphan-era garbage (~40,000-min sessions) is gone.
- **`pre_announce_jobs` = EMPTY all-time (0 rows).** Columns confirmed (created_at, status,
  attempts, sent_at…) but no rows → the durable fallback queue is **not accumulating** (inline
  pre-announce sends succeed; nothing stuck). Pre-announce reliability currently healthy; **C2
  queue-backlog baseline = 0.**
- **`club_processing_locks` = EMPTY at probe instant** (locks are transient; no persistent rows) →
  **no reclaim history exists → B2 must ADD reclaim observability** (cannot be baselined from
  current data).

A0 is closed. The one-shot probe workflow + script can be deleted (served its purpose). Next: A1
(canonical config consolidation, frontend/shared, no behavior change), then C1.
