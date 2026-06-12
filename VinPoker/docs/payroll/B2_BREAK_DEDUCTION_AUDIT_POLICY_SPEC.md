# B2-PR1 — Break Source Audit + Policy Spec (docs-only)

**Session:** Payroll B2-PR1 — Break Source Audit + Policy Spec (2026-06-13, read-only)
**Status:** AWAITING OWNER/PO SIGN-OFF — no formula change has been made. B2-PR3 (formula) must not start until the three policy decisions below are answered.
**DB grounding:** linked test DB `orlesggcjamwuknxwcpk`, all queries read-only.

---

## 1. Break data audit (live, 2026-06-13)

### Sources

| Table | Rows | Verdict |
|---|---|---|
| `dealer_breaks` | 289 total, 254 in June 2026, 2 clubs, 94 distinct attendance rows | **Primary source.** Schema: `id, assignment_id, break_start, break_end, expected_duration_minutes, reason, attendance_id, club_id`. `attendance_id` joins directly to `dealer_attendance` — clean join path for payroll. |
| `shift_break_policies` | 3 rows (one per club, `shift_type='default'`) | Rotation policy only: `min_work_before_break=90`, `mandatory_by=120`, `target_break_duration=15`, `variance=10` (minutes). **No pay-policy fields exist** (paid/unpaid, allowance). |
| `dealer_meal_breaks` | 4 rows | Nearly unused — EXCLUDE from B2 v1; revisit if meal tracking becomes real. |
| `get_dealer_payroll` (orphaned fn) | 1 overload | Reference only. Subtracts raw `break_end − break_start` (open break → +20min default) joined via `dealer_assignments`. **Inferior to what B2 needs** — no window clamping (see risk R1), different join path. Do NOT copy verbatim. |

### Quality metrics (all 289 rows)

| Metric | Value |
|---|---|
| Open breaks (`break_end IS NULL`) | **0** |
| Negative durations | **0** |
| Missing `attendance_id` | **0** |
| Breaks starting before check-in | **0** |
| **Breaks ending AFTER check-out** | **196 (68%)** |
| Breaks on still-open shifts | 38 |
| Overlapping break pairs (same attendance) | 2 |
| Breaks > 2h | 5 (max ≈ 872 minutes — clear bookkeeping outlier) |
| Mean duration (raw) | 32 min |

### Money impact estimate (June 2026, clamped to shift window)

`clamped_minutes = GREATEST(0, LEAST(break_end, check_out) − GREATEST(break_start, check_in))`

| Club | Type | Breaks | Clamped break min | Est. VND if fully unpaid (hourly basis) |
|---|---|---|---|---|
| 111… Saigon | FT | 22 | 296 | ~213,414 |
| 111… Saigon | PT | 19 | 125 | ~69,591 |
| 222… Hanoi Royal | FT | 150 | 1,387 | ~999,940 |
| 222… Hanoi Royal | PT | 15 | 48 | ~80,158 |
| **Total** | | 206 within-window | **~1,856 min** | **~1.36M VND / month** |

Key insight: raw break time ≈ 9,250 min but only ~1,856 min falls INSIDE the paid window — **most recorded break time spills past checkout** and is already unpaid. Clamping is not optional; without it B2 would over-deduct ~4×.

---

## 2. Data quality risks

| # | Risk | Mitigation in B2 design |
|---|---|---|
| R1 | 68% of breaks have `break_end > check_out_time` (rotation closes break records late) | **Mandatory window clamping** — deduct only the intersection with `[check_in, check_out]` |
| R2 | 5 breaks > 2h, max ≈ 872 min (forgot-to-end-break) | Per-break deduction cap (e.g., cap deductible at `target + variance + abuse ceiling`, или surface as anomaly instead of silently deducting a full day) |
| R3 | 2 overlapping break pairs | Merge overlapping intervals before summing (interval union, not naive SUM) |
| R4 | 38 breaks on open shifts (no check_out yet) | Same rule as open shifts today: clamp to `now()` (24h-capped window) — consistent with existing B4 behavior |
| R5 | Break data is rotation-bookkeeping, not payroll-grade time tracking | Dry-run money report before apply; policy defaults that only punish outliers (grace), not normal mandated rest |
| R6 | `dealer_meal_breaks` nearly empty | Exclude from v1 — document explicitly so no one assumes meals are deducted |
| R7 | FT pay is **shift-count prorated**, not hourly | Break deduction affects FT only через hours→OT; PT hourly affected directly. Money model differs per employment type — golden diff must include both |

---

## 3. Policy decision matrix (OWNER MUST ANSWER)

### Q1 — Are breaks paid or unpaid?

| Option | Consequence | Money (June est.) |
|---|---|---|
| A. All paid (status quo) | No B2 needed; close B2 as "policy: paid" | 0 |
| B. All unpaid | Deduct every clamped break minute; dealers lose pay for club-MANDATED rest (rotation forces a break by 120 min) — high dispute risk | ~1.36M/month |
| **C. Paid up to allowance, excess unpaid (recommended)** | Mandated rest stays paid; only over-long breaks deducted | small (targets the 5+ outliers) |

### Q2 — Grace/allowance per break?

| Option | Note |
|---|---|
| 0 min (strict) | = Option B |
| **25 min = `target_break_duration (15) + variance (10)` (recommended)** | Reuses the club's own rotation policy numbers — defensible to dealers ("you only lose pay beyond the policy you already agreed to") |
| Per-shift pooled allowance (e.g., 30 min/shift) | Fairer for split breaks but harder to explain; v2 candidate |

### Q3 — Does deduction reduce OT or only regular minutes?

| Option | Consequence |
|---|---|
| **Reduce total worked minutes BEFORE regular/OT split (recommended)** | Consistent: hours = (window − deductible breaks), then split regular/OT as today. No OT inflation |
| Reduce regular only | OT artificially preserved → can pay MORE OT than actually worked late hours |
| Reduce OT first | Punitive; complex edge cases |

---

## 4. Recommended default policy (pending sign-off)

```
break_deduction_enabled:        per club (default OFF until owner enables)
deductible minutes per break:   clamped_to_shift_window − 25min grace (floor 0)
overlap handling:               merge intervals before summing
per-break deduction cap:        120 min (beyond that → anomaly warning, not silent deduction)
meal breaks:                    excluded v1
application point:              subtract from total worked minutes BEFORE regular/OT split
employment types:               PT directly hourly; FT affects OT hours only (base stays shift-prorated)
saved periods:                  NEVER retro-recomputed (snapshots stay as saved)
```

With this default, June 2026 deduction ≈ only the >25min-clamped portions (mean clamped break ≈ 9 min) → near-zero money movement except genuine outliers. B2 v1 is an **abuse guard**, not a pay cut.

---

## 5. Proposed B2 PR split

| PR | Content | Gate |
|---|---|---|
| **B2-PR1 (this doc)** | Audit + policy spec | Owner answers Q1/Q2/Q3 |
| **B2-PR2** | Additive pay-policy columns on `shift_break_policies` (`break_deduction_enabled boolean DEFAULT false`, `paid_break_allowance_minutes int DEFAULT 25`, `max_deductible_minutes_per_break int DEFAULT 120`) — source + controlled apply | B2-PR1 signed |
| **B2-PR3** | `calculate_dealer_payroll` formula migration (snapshot → patch → golden diff → dry-run money report both clubs → apply) + source alignment | B2-PR2 live; dry-run report approved by owner |

---

## 6. Exact verification plan (B2-PR3, when opened)

1. **Pre-patch:** snapshot live `calculate_dealer_payroll` (md5; current: `0ffc563d65f12790a17b4673c82a3dce`).
2. **Dry-run money report (BEFORE apply):** run patched logic as a standalone SELECT (not CREATE) over June 2026 both clubs → per-dealer delta table → owner approves the money movement.
3. **Golden diff (unsaved view):** June 2026 both clubs, BEFORE/AFTER RPC JSON: only dealers with deductible (post-grace, post-clamp) break minutes change; hand-computed expected values for ≥3 affected + ≥3 unaffected dealers must match exactly.
4. **Edge cases asserted:** break spilling past checkout (clamped), overlapping pair (merged), >2h break (capped + anomaly), open shift (clamps to now), dealer with 0 breaks (byte-identical), FT vs PT both covered.
5. **Saved periods:** stored `dealer_payroll` md5 unchanged; saved-path RPC output unchanged (B5 semantics intact).
6. **UI:** hours/pay columns consistent; no anomaly-strip regression.
7. **Rollback:** re-apply snapshot (CREATE OR REPLACE, instant).
8. **DB safety:** no db push, no deploy_db, no schema_migrations edits; policy columns additive-only.

---

## 7. Explicitly deferred

- Per-shift pooled allowance (v2), meal-break handling, break-policy admin UI, retroactive recompute of any saved period, B7 server recompute (separate phase), Dealer Swing rotation logic (READ-only forever from payroll side).
