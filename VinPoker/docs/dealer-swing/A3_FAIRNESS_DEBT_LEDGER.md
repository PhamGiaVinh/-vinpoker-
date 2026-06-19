# A3 — Fairness-Debt Ledger (DESIGN DOC ONLY)

> Status: **DESIGN ONLY — no code, no DB, no migration, no RPC, no Edge, no frontend, no deploy.**
> Step A3 of the Dealer Swing hardening roadmap. Defines a *future* fairness-debt policy so it can
> be reviewed before any implementation. Nothing here ships until a separate, owner-gated code PR.

## 0. Why this exists

The scorer (`pickNextDealer.buildDealerCandidates`) already has ONE fairness signal — the
`break_equity_penalty` (PHASE 2 soft term): a dealer whose break ratio is below the club average is
**penalised** (−80 if < 0.7× avg, −30 if < 0.9× avg). That is the "you've rested less than peers →
slightly deprioritise sending you to *another* full swing" side.

What's missing is the **credit** side: when a dealer repeatedly absorbs *unfairness* — skipped while
eligible, long consecutive runs, pulled into OT via the emergency bypass, parked on high-pressure
HIGH tables — nothing remembers it, so the system never *makes it up to them* later (e.g. by giving
them the next break, or NOT picking them first next round). Fairness-debt is that memory: a small,
bounded, decaying **credit** that nudges later soft scoring toward the dealers the system has been
unfair to. It is a refinement of fairness, **not** a safety mechanism.

**North-star principle (non-negotiable):** fairness-debt may only reorder *eligible* candidates in
PHASE 2. It must **NEVER** relax a PHASE 1 hard gate (rest, fatigue cap, priority-break, tier,
busy, game-type) and must **NEVER** be a reason to pull an under-rested dealer back early. Rest and
safety always win over fairness.

## 1. When does fairness debt ACCRUE? (Q1)

Debt accrues when a dealer absorbs a unit of unfairness the system created. Evaluated triggers:

| Trigger | Accrue? | Rationale / weight intent |
|---|---|---|
| **Skipped while eligible** (was a valid candidate but a lower-need peer was picked) | ✅ YES | The core fairness miss. Smallest unit; accrues per skip. Detectable from the candidate set vs the pick. |
| **Carried too many consecutive swings** (`consecutive ≥ threshold`) | ✅ YES | Over-work. Note: scorer already *penalises* this live (`consecutive_penalty`, `heavy_worker_penalty`); debt is the *lagging* memory so the make-up survives into the next round. Avoid double-counting (see §8). |
| **Less rest than peers** (rest below roster median when picked) | ✅ YES (small) | Relative under-rest. Distinct from the hard rest gate (which is absolute). |
| **Pulled into emergency / OT path** (`skipPriorityBreakGuard` or `skipFatigueHardCap` bypass used to pick them) | ✅ YES (largest) | The system *overrode their break* to save a table. Strongest fairness IOU — they should be first to get relief/rest next. |
| **Covered high-pressure / high-tier table** (tourTier HIGH, or `priority_swing`) | ✅ YES (small) | Higher stress load. Optional/low weight; off by default until floor confirms it's wanted. |

**Not accrual:** a dealer who is simply available and not picked because a *higher-need* peer won
(that's the system working) — only count a "skip" as debt when the picked dealer had *lower* need
by the very signals fairness cares about. Keep accrual conservative; over-accrual causes oscillation
(§8).

## 2. When does fairness debt EXPIRE? (Q2)

Debt must be **transient within a shift** and self-clearing. Recommended:

- **Primary: decay toward zero after the dealer receives the make-up.** When a flagged dealer gets
  the balancing outcome (a break, or is the one *not* picked for the next full swing, or simply
  rests ≥ threshold), the matching portion of debt is consumed/decayed. "One balancing assignment"
  is too coarse (a single break shouldn't wipe a whole OT shift of debt) — decay proportionally.
- **Time decay:** half-life of **~2–3 hours** so stale unfairness fades (a miss at 14:00 shouldn't
  still dominate at 23:00).
- **Hard reset at shift/day boundary** (and on check-out): debt does NOT carry across days or across
  a check-out/check-in cycle. Fairness is a *within-shift* balancing concept; cross-day carry would
  reward absenteeism (§8) and drift from the live roster.

Net: debt is *consumed by make-up*, *decays by time*, and *resets at shift end* — whichever comes
first. No debt should be "owed" to a dealer who is no longer on shift.

## 3. Is fairness debt CAPPED? (Q3)

Yes — both a hard cap and decay, to prevent one dealer accumulating runaway priority:

- **Hard cap per dealer:** total debt-derived soft bonus is clamped to a small ceiling — recommend
  **≤ +60** (for scale: rest_bonus tops at +200, tier_bonus +30, break_equity −80; a +60 fairness
  nudge can break ties and shift borderline picks but can NOT, alone, beat a well-rested skilled
  dealer). Fairness should *tilt*, never *dominate*.
- **Per-trigger cap:** each accrual contributes a bounded amount; emergency/OT highest (~+30),
  skip-while-eligible mid (~+15), relative-under-rest/high-tier small (~+5–10). All summed then
  clamped to the per-dealer ceiling.
- **Decay:** time half-life (§2) + consumption on make-up. Decay guarantees the cap is rarely hit
  and debt trends to 0 when the system is being fair.
- All numbers above are **intent/placeholders for design review** — the real values live in
  `swingPolicy.ts` (per A1) at implementation time and get the same golden-diff treatment as A2.

## 4. HARD eligibility or SOFT score? (Q4) — **REQUIRED DEFAULT: SOFT ONLY**

**Fairness-debt affects SOFT scoring ONLY, after PHASE 1 eligibility has already passed.**

- It is a new PHASE 2 term (a positive `fairness_debt_bonus` in `ScoreBreakdown`), applied alongside
  `break_equity_penalty` / `rest_bonus` / etc., then clamped (§3).
- It **NEVER** appears in PHASE 1. It can never: relax the rest cooldown, bypass the fatigue hard
  cap, override the priority-break hard gate, admit a tier-C dealer to a HIGH table, or pull an
  under-rested dealer back early. A dealer owed huge debt who is still under-rested **stays excluded**
  — their make-up is "you get to keep resting," not "we override safety to use you."
- Corollary: fairness-debt can only ever change the *ordering* among dealers who are *all already
  eligible*. If only one dealer is eligible, debt is irrelevant (no reorder possible).

This mirrors the A2 decision (priority_break = hard gate, never a soft veto): hard safety and soft
preference stay in separate phases, and fairness lives strictly in the soft phase.

## 5. Does the floor SEE it? (Q5)

Yes — as **explainability**, reusing the C1 surface, never as a raw number.

- Surface it the same way C1 surfaces reject reasons / score gaps: a short Vietnamese phrase in the
  assign-modal suggestion `reason` and (optionally) a chip, driven by a label map like C1's
  `SCORE_LABELS` — render only when the bonus is non-zero.
- **Do NOT show raw debt points** ("+47 fairness debt") — confusing and gameable. Show *why*, framed
  as a fairness nudge.
- Suggested Vietnamese copy (pick the dominant accrual reason):
  - Skipped repeatedly → **"Ưu tiên công bằng — bị bỏ lượt nhiều"**
  - Heavy consecutive load → **"Cân bằng — làm nhiều ca liên tục"**
  - Pulled into OT/emergency → **"Cân bằng — đã gánh ca khẩn cấp"**
  - Under-rested vs peers → **"Cân bằng — nghỉ ít hơn đồng nghiệp"**
  - Generic fallback → **"Ưu tiên cân bằng ca trực"**
- In the C1 reject panel, fairness-debt is NOT a reject reason (it never excludes) — it only ever
  explains why an eligible dealer was *preferred*. Keep it out of the "vì sao bị loại" list.

## 6. Proposed DATA MODEL (design only — DO NOT implement)

Three options, in order of preference:

- **Option A — computed on the fly (RECOMMENDED for MVP).** Derive debt at scoring time from data the
  scorer already loads or can cheaply query in `buildDealerCandidates`: recent `dealer_assignments`
  (consecutive runs, last-N picks → skip detection vs the candidate set), `dealer_shift_metrics`
  (minutes_since_rest vs roster median), and the emergency-bypass flags in the current tick. No new
  table, no migration, no persistence. Debt is ephemeral and always reflects *now*. Aligns with A0a's
  finding that decision-time state is not currently event-sourced — compute-on-fly sidesteps that.
- **Option B — in-memory per-tick accumulator.** The process-swing run tallies "skipped-while-eligible"
  within its own passes and feeds it to later picks in the same tick. Cheap, but forgets across ticks.
  Useful only as a refinement on top of A.
- **Option C — persisted ledger (future, only if proven necessary).** A table that records accrual
  events so debt survives across cron ticks and is auditable. ONLY if Phase-1/2 prove compute-on-fly
  can't capture cross-tick fairness (e.g. skips that span many ticks).

**Suggested future table shape (Option C — NOT to be created now):**

```
dealer_fairness_debt        -- one row per (attendance, accrual event); debt = decayed sum
  id                uuid pk
  club_id           uuid
  attendance_id     uuid    -- scopes debt to the current shift (resets on check-out, §2)
  dealer_id         uuid
  reason            text    -- skipped_eligible | heavy_consecutive | under_rested | emergency_ot | high_tier
  points            int     -- bounded per-trigger contribution (§3)
  accrued_at        timestamptz
  consumed_at       timestamptz null  -- set when made-up; decayed rows pruned by a cleanup job
  shift_date        date
-- current debt = Σ points·decay(now − accrued_at) over rows where consumed_at IS NULL,
--                clamped to the per-dealer cap (§3), scoped to the active attendance.
```

If Option C is ever built, it follows the standard controlled-apply path (source-only migration →
owner-gated apply), and any debt-derived weights live in `swingPolicy.ts`.

## 7. Interaction with existing signals

| Existing signal | Phase | Relationship to fairness-debt |
|---|---|---|
| `priority_break_flag` (A2 hard gate) | PHASE 1 | Independent. Debt never relaxes it. BUT being pulled in via `skipPriorityBreakGuard` is a top **accrual** trigger (§1). |
| `restMin` / `restThreshold` (rest cooldown + on-break guard) | PHASE 1 | Independent hard gate. Debt never lowers the rest bar. "Under-rested vs peers" accrual is *relative* and only affects soft score, distinct from the absolute hard threshold. |
| `consecutive` swings (`consecutive_penalty`, `heavy_worker_penalty`) | PHASE 2 (penalty) | Same underlying fact (over-work). Debt is the *lagging memory* of it. **Must not double-count** — see §8; recommend debt accrues from consecutive load but the live penalty stays the primary in-tick signal. |
| `break_equity_penalty` (existing fairness, PHASE 2) | PHASE 2 (penalty) | Complementary opposite side: equity = *penalty* for low rest ratio now; debt = *credit* for absorbed unfairness over time. Implement debt as a **separate** `fairness_debt_bonus` field; do not fold into break_equity (keeps C1 explainability and golden-diff clean). |
| `skipPriorityBreakGuard` / `skipFatigueHardCap` (emergency bypass) | PHASE 1 override | Strongest accrual trigger (§1). The dealer sacrificed safety margin for the room; the IOU is real. Debt never *causes* a bypass — only records when one was used on them. |
| `priority_swing_bonus` (+300, priority table) | PHASE 2 (bonus) | Orthogonal (table-need, not dealer-fairness). Fairness-debt's cap (≤+60) keeps it well below priority_swing so urgent tables still win. |

## 8. Failure modes & mitigations

| Failure mode | How it happens | Mitigation |
|---|---|---|
| **Oscillation / flip-flop** | Debt makes A preferred → A picked → A now over-worked → debt flips to B → ping-pong each tick | Decay + consumption (§2); per-dealer cap (§3); apply debt as a *tie-breaker-scale* nudge (≤+60), not a dominant term; add hysteresis (don't re-credit a dealer within N minutes of a make-up). Double-count guard with `consecutive_penalty`. |
| **Rewarding absenteeism** | A dealer off-shift / on long break "accumulates" relative under-rest or skips and returns with huge priority | Shift/check-out reset (§2); debt scoped to active `attendance_id`; only accrue for dealers who were actually *eligible and present*; a dealer not in the pool can't accrue skip-debt. |
| **Debt overriding safety** | Pressure to "make it up" pulls an under-rested/ fatigued dealer back early | Hard architectural rule (§4): debt is PHASE 2 only, clamped, never touches PHASE 1. Unit test asserts a high-debt under-rested dealer is still excluded. |
| **Floor misunderstands the score** | Raw "+47" shown; floor thinks it's a bug or games it | Never show raw points (§5); show a short Vietnamese reason only; keep it out of the reject-reason list (it never excludes). |
| **Silent drift / unverifiable** | Compute-on-fly debt changes picks but nothing is observable | Phase 2 = read-only diagnostics first (surface the bonus + reason via C1) BEFORE it influences scoring at full weight; C3 per-pass metrics can later count debt-driven reorders. |

## 9. Recommended MVP implementation path (future PRs, owner-gated)

- **Phase 1 — computed-only, no DB, no behavior change at full weight.** Add a pure
  `computeFairnessDebt(candidateContext) → points` helper (Option A inputs) and a
  `fairness_debt_bonus` field in `ScoreBreakdown` initialised 0; weights in `swingPolicy.ts`. Ship it
  **behind a flag / at weight 0** so output is byte-identical until enabled (mirrors A1/A2 discipline).
  Synthetic-harness tests (the A2 `pickNextDealer.test.ts` pattern) prove accrual logic + the
  cap + the "never overrides hard gate" invariant.
- **Phase 2 — read-only diagnostics.** Surface the computed bonus + Vietnamese reason in the C1
  assign-modal (display only; still weight 0 in scoring). Floor observes whether the reasons make
  sense for 1–2 weeks. This is the fairness analogue of C1.
- **Phase 3 — enable soft influence, then (only if needed) persist.** Raise the weight from 0 to the
  capped values with a golden-diff + post-merge observation (like A2). Build the persisted ledger
  (Option C) ONLY if Phase 1/2 prove compute-on-fly misses cross-tick fairness; otherwise stay
  compute-only forever.

Each phase = its own owner-gated PR. Do not skip straight to a persisted ledger.

## 10. Rollback strategy (for any future implementation)

- **Weight rollback (primary):** set the fairness-debt weights in `swingPolicy.ts` to 0 → behavior
  reverts to today's scoring instantly, no other change. (This is why weight-0 + flag is the safe
  default in Phase 1.)
- **Code rollback:** revert the PR; `fairness_debt_bonus` stays in `ScoreBreakdown` as a 0 field
  (like `priority_break_penalty` after A2) so C1 shape is unaffected.
- **DB rollback (only if Option C built):** the ledger table is additive; dropping it or ignoring it
  leaves compute-on-fly / weight-0 behavior intact. Standard controlled rollback snapshot.
- No rollback ever requires touching PHASE 1 (safety) — fairness-debt is isolated to PHASE 2 by design.

## 11. Acceptance criteria for the future code PR

- `computeFairnessDebt` is a **pure function** with synthetic-harness tests covering each accrual
  trigger (§1), the per-trigger + per-dealer caps (§3), and time decay (§2).
- **Invariant test:** a dealer with maximal fairness-debt who fails ANY PHASE 1 hard gate (under-rested,
  fatigued, priority-break under threshold, wrong tier, busy) is **still excluded** — debt never admits.
- **Equal-eligibility test:** among fully-eligible identical dealers, the one with higher debt is
  preferred, but the preference is bounded by the cap (can't beat a clearly-better-rested/skilled peer).
- **No-double-count:** debt + `consecutive_penalty`/`break_equity_penalty` do not compound into runaway
  bias (documented interaction; test a heavy-consecutive dealer doesn't get both a large penalty *and*
  a large make-up in the same tick).
- **C1 shape preserved:** `fairness_debt_bonus` added to `ScoreBreakdown`; existing fields unchanged;
  reject panel unaffected (debt is never a reject reason).
- **Weight-0 byte-identical:** with weights at 0, `deno test` proves scorer output identical to pre-PR
  (the "no behavior change until enabled" gate).
- **Golden / observation:** enabling the weight follows the A2 playbook — comment-stripped diff,
  analytical before/after, post-merge observation of overdue / shortage / fairness CV /
  `priority_break_excluded`. Rollback = weights → 0.
- Source-only first; controlled apply only if Option C (DB) is built; owner-gated merge + deploy.

## 12. Recommended policy decisions (summary for owner sign-off)

1. **Scope:** SOFT-only, PHASE 2, clamped (≤ ~+60). Never touches PHASE 1 safety. ✅ required default.
2. **Accrual:** skipped-while-eligible + heavy-consecutive + under-rested-vs-peers + emergency/OT
   (largest); high-tier optional/off by default.
3. **Expiry:** consumed on make-up + ~2–3h half-life decay + hard reset at shift end / check-out.
   No cross-day carry.
4. **Cap:** per-trigger bounded, per-dealer ceiling ~+60, time decay.
5. **Floor visibility:** C1-style Vietnamese reason only, never raw points, never in the reject list.
6. **Data model:** compute-on-fly (Option A) for MVP; persisted ledger (Option C) only if proven
   necessary.
7. **Rollout:** Phase 1 (computed, weight 0) → Phase 2 (read-only diagnostics) → Phase 3 (enable +
   maybe persist), each owner-gated.

Open questions for owner before any code PR: (a) confirm the per-dealer cap magnitude; (b) confirm
whether high-tier coverage should accrue at all; (c) confirm half-life (2h vs 3h); (d) confirm whether
Phase 2 read-only diagnostics is wanted before any scoring influence (recommended yes).
