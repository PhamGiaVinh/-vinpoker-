# VinPoker Club Intelligence — Product Specification (CI-0.x, Full Version Phase 0)

**Module:** `src/features/club-intelligence/` (planned — not created)
**Status:** Spec only. No code, no schema applied, no migration, no flag, nothing deployed.
**Source prototype:** standalone `vinpoker-club-intel` (P1–P8 complete; commits `08ec982` P1–P7, `0d95aa1` P8 UX, `3c8e435`/`a410963` demo script).
**Phase:** Full Version Phase 0 (planning).
**Companion docs:** [`DATA_MODEL.md`](./DATA_MODEL.md) · [`ROADMAP.md`](./ROADMAP.md) · [`SAFETY_BOUNDARY.md`](./SAFETY_BOUNDARY.md)

> This document defines WHAT the production module is and WHAT it must never claim. The data model,
> phased build, and security contract live in the companion docs. Nothing here authorizes a code,
> DB, RPC, edge, flag, or UI change — those follow the roadmap, each owner-gated.

---

## 1. Product definition & one-line promise

VinPoker Club Intelligence is a **B2B, market-aware rules engine + club business-intelligence tool
for poker-club owners**. It reads a club's own historical tournament data (and optional market
context), tells the owner **what that data does and does not support**, surfaces labeled
opportunities/risks for the owner to **review**, and measures the discipline of human forecasts.

**One-line promise:** *"It explains what your club's own data supports — it does not predict,
recommend, or optimize. You decide."*

It productionizes the proven prototype pipeline:
Data Readiness → Descriptive Club Memory → Pricing/Rake decomposition → Rules Engine →
Observed Schedule Draft → Owner Report → Shadow Forecast Lab, presented in an Owner Command Center.

## 2. Non-goals (locked)

These are permanent product boundaries, not temporary limitations.

- **(locked) NOT AI prediction.** The engine is deterministic and rules-based. There is no model
  predicting future entries, revenue, or behaviour.
- **(locked) NOT an automatic schedule optimizer.** It never produces a "best" or "recommended"
  schedule. It re-surfaces combinations the club has *already run*, organized by risk posture, for a
  human to decide.
- **(locked) NOT a profit-forecast tool unless real cost data exists.** With only buy-in / rake /
  prize structure, it shows price *structure*, never profit or P&L. Profit requires real
  line-item cost data (staff, venue, F&B), which is out of scope until that data is modeled.
- **(locked) NOT a causal engine.** Descriptive output is never presented as cause-and-effect.

The full forbidden-claims list is binding in [`SAFETY_BOUNDARY.md` §1](./SAFETY_BOUNDARY.md).

## 3. The three intelligence tiers (locked)

Every capability belongs to exactly one tier; tiers never skip.

1. **RULES** — principles that can be encoded deterministically *today*. Each rule carries a
   provenance string and a kill-condition. Output labels: `Known Rule`, and (for unproven
   correlations) `Hypothesis`.
2. **DESCRIPTIVE** — the club's *own* observed history (entries, slots, price structure, liquidity).
   Always labeled `Observed Pattern`. **Never** claims causality.
3. **LEARNED-CAUSAL — DEFERRED (locked).** Cross-club, causal, or estimated findings
   (cannibalization, pricing-response, profit/risk models, forecast ranges) require **pooled
   multi-club data** and a separate spec. Held until after F8. Labels `Tested Finding` /
   `Model Estimate` are reserved for this tier and MUST NOT appear in F1–F8.

## 4. The five output labels (locked)

Every insight the module renders carries **exactly one** label and a non-empty provenance string.

| Label | Tier | Meaning | Emitted in F1–F8? |
|---|---|---|---|
| `Known Rule` | RULES | An encodable industry/operational principle (with provenance + kill-condition). | Yes |
| `Observed Pattern` | DESCRIPTIVE | A fact measured from the club's own uploaded/native data. Never causal. | Yes |
| `Hypothesis` | RULES | A correlation worth a controlled test; explicitly "needs a test", never a conclusion. | Yes |
| `Tested Finding` | LEARNED-CAUSAL | A hypothesis confirmed by controlled test / pooled evidence. | **No — reserved** |
| `Model Estimate` | LEARNED-CAUSAL | A value from a fitted model with a stated uncertainty range. | **No — reserved** |

`cannibalization` is always `Hypothesis` until pooled data exists (locked).

## 5. User roles & what each sees

Roles reuse VinPoker's existing auth (`useAuth()` → `isClubOwner` via `clubs.owner_id` /
`is_club_owner(uid, club_id)` RPC; `isClubAdmin` via `user_roles` `club_admin`/`super_admin`).

| Role | Determined by | Sees |
|---|---|---|
| **Owner** | `is_club_owner(auth.uid(), club_id)` | Everything for their club: Command Center, Owner Report (+ lockable snapshots), all rule runs, readiness, schedule drafts, pricing, shadow discipline. |
| **TD / floor manager** | `club_admin` or club staff (`club_members`/`club_cashiers`) | Data Readiness, Descriptive Club Memory, Observed Schedule Draft. No finance-derived rake economics beyond what the floor already sees. |
| **Finance / admin** | `club_admin` (finance context) | Pricing/Rake decomposition, CSV import operator, shadow-forecast entry. Still no profit (none exists). |

All access is club-scoped; no cross-club, no anonymous (see [`SAFETY_BOUNDARY.md` §3](./SAFETY_BOUNDARY.md)).

## 6. Data sources & the Data-Readiness-first rule (locked)

Three sources feed the canonical observation grain (details in [`DATA_MODEL.md`](./DATA_MODEL.md)):

1. **Native VinPoker data** — `tournaments` + `tournament_registrations` (+ `stack_registrations`),
   with `leaderboard_entries` used only for reconciliation. Projected into observations by a
   read-only adapter (F2). This is the primary, trusted source.
2. **CSV import of old club history** — for tournaments that predate VinPoker. Two-stage:
   parse into untrusted staging, then promote to observations (F1). Mirrors the prototype loader
   (5 MB / 2000-row caps, formula-injection-safe).
3. **Human-entered shadow forecasts** — the owner/TD's own predictions, stored to be *scored*
   against actuals (F7). The system never produces these numbers.

**(locked) Data Readiness runs FIRST.** No analysis surface renders before its readiness
requirement is met. If `rake_comp` is absent, pricing analyses report "not enough data" rather than
guessing. No false precision, ever.

## 7. Rules engine — versioning & provenance

The Rules Engine is declarative data + a deterministic evaluator (productionizes prototype P4).

- A rule is `{ id, type, label, severity, condition[], message, provenance, kill_condition[] }`.
- The active rule set has a `rule_set_version`. Every evaluation is persisted as an immutable
  `club_intel_rule_runs` row capturing the **facts** it saw and the **findings** it produced (each
  with label + provenance + severity), tagged with `rule_set_version` → fully reproducible.
- A rule's `kill_condition` retires it (suppresses firing) when its preconditions no longer hold;
  killed rules are recorded for transparency, not hidden.
- **Determinism (locked):** same facts + same `rule_set_version` ⇒ identical findings. No randomness,
  no model, no time-dependence.

## 8. Descriptive Club Memory boundary

Productionizes P2: tour strength (by `event` × `final_entries`), slot performance (by `time`), and
level-1 liquidity (by `level1_entries`). Every output is labeled `Observed Pattern` and is strictly
historical. It states *what happened*, with sample sizes visible, and **never** asserts *why*
(no causality — locked). Single-occurrence events are shown with `n=1` so nothing reads as more
reliable than it is.

## 9. Pricing / Rake decomposition (observed only, no profit)

Productionizes P3: X+Y decomposition (`buy_in = prize_component + rake_component`), effective rake
yield %, early/late price ladder, late-rake multiple, free-rake cap as observed config. Neutral
structural metrics only. **(locked) No profit, no P&L, no "expected" figure** — there is no cost
data. X+Y consistency is reported neutrally (`✓ matches` / `≠ mismatch`), never as a "transparency
warning". X+Y public pricing is industry-standard and is treated as neutral.

## 10. Owner dashboard UX structure

Productionizes P8 (Owner Command Center) into the VinPoker design system (F8):

- **Shell:** left sidebar section nav + header with a persistent trust strip
  (Local/club-scoped · Rules-based · No AI prediction).
- **Overview (Command Center):** metric cards (data readiness, tournaments, schedule posture,
  forecast discipline) + observed mini-bars + a 3-opportunity / 3-risk briefing preview —
  reusing already-computed numbers only, never new metrics.
- **Sections:** Owner Report (executive summary) · Data Readiness · Club Memory · Pricing/Rake ·
  Rules · Schedule Draft · Shadow Forecast. Long tables collapse into "view details"; evidence and
  provenance are never hidden, only tucked.
- Every finding renders with its label badge + provenance. (The prototype dark palette is a
  reference; production adopts the VinPoker design system per the UI/UX master map.)

## 11. Observed Schedule Draft — honesty boundary (locked)

Productionizes P5 as a **scenario-posture engine, not an optimizer**.

- It assembles **only event×slot combinations the club has already run** — it never invents an event
  or slot.
- Three postures (Conservative / Balanced / Aggressive) are **risk/assumption tolerances over the
  same observed combos**, never "good/bad/best". `risk` is a property of the combo and is identical
  across postures; the posture only changes whether a combo is *allowed / needs-review / excluded /
  blocked*, with a stated reason.
- **(locked) No expected/projected entries, no recommended/best schedule, no causal claim.** Each
  line shows observed values (avg/min/max + n), source rule, risk label, missing data, and why it
  is allowed or blocked.

## 12. Owner Report — "not a decision"

Productionizes P6: a deterministic briefing that **only re-expresses** existing engine output
(3 opportunities / 3 risks / a weekly draft), each item labeled with provenance + missing-data.
It creates no new number and no new conclusion. Header states verbatim: *"a summary for the
owner/TD to review — not a decision made for the human."* Snapshots are immutable and lockable
(see [`DATA_MODEL.md`](./DATA_MODEL.md)).

## 13. Shadow Forecast — discipline boundary (locked)

Productionizes P7: it reads **human-entered** forecasts and compares them to actuals (entered, or
auto-matched from observed `final_entries`), computing **discipline** metrics (bias, MAE, MAPE,
hit-rate within ±10%). **(locked) The system itself never forecasts and never recommends a future
number.** It measures how accurate the human's past forecasts were. The forecast value is the only
place an "expected" number may exist — because it is explicitly a *human claim being scored*.

## 14. Feature gating & per-club enablement

- The module is gated behind a frontend feature flag (consistent with existing flags such as
  `onlinePoker` / `liveActionEngine`) **and** a per-club enable.
- The per-club substrate is `app_settings` (global key/value) and/or `club_settings` (per-club);
  the exact mechanism is **confirmed in F1** before any UI ships.
- Default OFF. No surface renders for a club until both the flag and the club enable are on.

## 15. Glossary

- **final_entries** — entries at tournament close (native: `count(registrations status='confirmed')`).
- **level1_entries** — entries present at level 1 / early window (native: `count(status='committed')`).
- **rake yield %** — `rake_component / buy_in × 100` (observed structural metric, not profit).
- **late-rake multiple** — `(late_price − early_price) / rake_component`.
- **posture** — a risk/assumption tolerance applied to observed combos (Conservative/Balanced/Aggressive).
- **discipline** — accuracy of *human* forecasts vs actuals (bias/MAE/MAPE/hit-rate). Not a forecast.
- **observation** — one normalized tournament instance (event × slot) — the canonical fact grain.

## 16. Cross-references

- Data model & native adapter → [`DATA_MODEL.md`](./DATA_MODEL.md)
- Phased build F1–F8 → [`ROADMAP.md`](./ROADMAP.md)
- Security / RLS / audit / forbidden claims → [`SAFETY_BOUNDARY.md`](./SAFETY_BOUNDARY.md)
