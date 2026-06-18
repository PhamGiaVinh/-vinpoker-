# VinPoker Club Intelligence — Production Roadmap (CI-0.x, F1–F8)

**Status:** Planned phases. Each phase is owner-gated and docs-or-controlled; nothing here is
scheduled or applied.
**Companion docs:** [`FULL_VERSION_SPEC.md`](./FULL_VERSION_SPEC.md) · [`DATA_MODEL.md`](./DATA_MODEL.md) · [`SAFETY_BOUNDARY.md`](./SAFETY_BOUNDARY.md)

---

## 1. Sequencing principles (locked)

- **Data Readiness first.** No analysis surface ships before its readiness gate (F1) governs it.
- **One phase, one concern, owner-gated.** Each phase stops for owner approval before the next.
- **Controlled DB ops only.** Migrations are applied via the controlled operation model
  (preflight → snapshot → single-purpose SQL → verify before/after → rollback note → report).
  **Never** `deploy_db=true` in CI; never `supabase db push` from a normal push.
- **Read-first.** Prefer SECURITY DEFINER read RPCs (precedent `get_club_finance_summary`) over
  broad table reads; writes are owner-actioned and audited.
- **Flag-gated + per-club.** Every shippable surface is behind a feature flag + per-club enable,
  default OFF.
- **Tier-3 deferred.** No LEARNED-CAUSAL capability (cannibalization, pricing-response, profit,
  forecast ranges) until pooled multi-club data exists — separate spec, post-F8.

## 2. Phases F1–F8

### F1 — Schema + RLS + audit + CSV-import foundation + Data Readiness
- **Goal:** stand up the `club_intel_*` schema, enums, RLS, audit trigger, CSV staging→promotion,
  and the readiness gate.
- **Deliverables:** `club_intel_datasets`, `club_intel_import_rows`, `club_intel_observations`,
  `club_intel_audit_log`; enums; RLS policies + SECURITY DEFINER read RPC scaffold; readiness RPC
  (which analyses a dataset supports); formula-injection-safe CSV import; the `is_ci_enabled(club)`
  gate (confirm exact flag mechanism: `app_settings`/`club_settings`).
- **Dependencies:** none.
- **Exit criteria:** an owner can import a CSV into staging, promote to observations, and view a
  readiness report; RLS proven (no cross-club, no anon); audit log populated.
- **Owner-gate:** owner approves the schema migration via a controlled op.

### F2 — Native → observation adapter
- **Goal:** project native `tournaments` + `tournament_registrations` (+ `stack_registrations`) into
  observations; `leaderboard_entries` reconciliation-only.
- **Deliverables:** SECURITY DEFINER read RPC implementing the [adapter mapping](./DATA_MODEL.md#7-native--observation-adapter-f2); owner-gated *materialize* writing a `native` dataset; the
  prize/rake split + entries derivations; a data-quality reconciliation rule (no profit).
- **Dependencies:** F1.
- **Exit criteria:** native and CSV observations are interchangeable inputs; readiness runs on native
  data; reconciliation discrepancies surface as data-quality findings.
- **Owner-gate:** owner triggers the first native materialization.

### F3 — Descriptive Club Memory
- **Goal:** productionize prototype P2 (tour strength, slot performance, level-1 liquidity), all
  `Observed Pattern`, never causal.
- **Deliverables:** descriptive read RPCs over observations; sample sizes surfaced.
- **Dependencies:** F1, F2.
- **Exit criteria:** descriptive surfaces render only for analyses readiness permits; no causal
  wording present.
- **Owner-gate:** review of labels/wording.

### F4 — Pricing / Rake decomposition
- **Goal:** productionize P3 (X+Y split, rake yield %, early/late ladder, late-rake multiple,
  free-rake cap), observed only.
- **Deliverables:** pricing read RPC; explicit absence of any profit/expected field; neutral X+Y
  consistency check.
- **Dependencies:** F2.
- **Exit criteria:** pricing surfaces show observed economics with no projection; finance-role review
  confirms no profit claim.
- **Owner-gate:** finance-role sign-off.

### F5 — Rules Engine + provenance + Owner Report snapshots
- **Goal:** productionize P4 (declarative rules + facts builder + deterministic evaluator) and P6
  (Owner Report).
- **Deliverables:** `club_intel_rule_runs` (immutable, `rule_set_version`, replayable facts);
  `club_intel_report_snapshots` (draft→lockable); the starter rule set with provenance +
  kill-conditions; label discipline enforced.
- **Dependencies:** F3 + F4 (facts need descriptive + pricing).
- **Exit criteria:** a rule run is reproducible from its facts; a report snapshot locks and is
  thereafter immutable.
- **Owner-gate:** owner reviews the initial rule set and can lock a report.

### F6 — Observed Schedule Draft
- **Goal:** productionize P5 posture engine (Conservative/Balanced/Aggressive) over **only** observed
  event×slot combos.
- **Deliverables:** schedule-draft read RPC honoring the honesty boundary; per-combo risk/evidence/
  fit + reasons; excluded/blocked transparency.
- **Dependencies:** F3 (observed combos).
- **Exit criteria:** the draft only re-orders observed combos by posture; **zero invented combos**
  verified; no expected/recommended wording.
- **Owner-gate:** owner confirms the honesty boundary in output.

### F7 — Shadow Forecast discipline
- **Goal:** productionize P7 (score human forecasts vs actual: bias/MAE/MAPE/hit-rate). The system
  never forecasts.
- **Deliverables:** `club_intel_forecasts` write + discipline read RPC joining to observations for
  actuals; forecast source labeled (human/imported).
- **Dependencies:** F2 (actuals) + F5 (label discipline).
- **Exit criteria:** discipline computed from human entries only; no system forecast appears.
- **Owner-gate:** owner reviews that no system forecast is present.

### F8 — Owner Command Center UX + RLS/audit hardening
- **Goal:** productionize P8 dashboard in the VinPoker design system + a final security pass.
- **Deliverables:** read-only owner dashboard wiring all RPCs behind the flag; sidebar nav, metric
  cards, label badges, collapsibles; RLS/audit hardening + the per-phase enforcement checklist from
  [`SAFETY_BOUNDARY.md`](./SAFETY_BOUNDARY.md).
- **Dependencies:** F1–F7.
- **Exit criteria:** every surface labeled; every read club-scoped; audit populated; the
  forbidden-claims checklist passes.
- **Owner-gate:** full security + boundary sign-off.

## 3. What each phase explicitly does NOT do

- No phase introduces AI/prediction, profit/P&L, a recommended schedule, or causal claims.
- No phase runs `deploy_db` in CI or `supabase db push` from a normal push.
- No phase touches payroll, finance, floor ops, the game engine, or unrelated migrations.
- No phase opens the LEARNED-CAUSAL tier.

## 4. Dependency graph

```
F1 ──> F2 ──┬──> F3 ──┐
            └──> F4 ──┴──> F5 ──> F6
                              └──> F7
F1..F7 ───────────────────────────> F8 (UX + hardening)
```

## 5. Tier-3 deferral (locked)

LEARNED-CAUSAL (pooled multi-club data; causal claims; `Tested Finding` / `Model Estimate` labels;
cannibalization, pricing-response, profit/risk models, learned forecast models) is **post-F8** and
requires its own spec. Until then, cannibalization remains `Hypothesis` and the last two labels stay
reserved.

> **Clarification (so the team does not read this as "no scenarios ever"):** what is deferred here
> is the **learned/causal** tier — a model that estimates outcomes from pooled multi-club data. It is
> **not** the same as the rules-based **Scenario Forecast Lite** in Phase 4 of the Native track below,
> which is deterministic, single-club, transparent, and presents **ranges as hypotheses**, not a
> learned point estimate. Phase 4 is allowed early; the learned tier stays post-F8.

---

## 6. Native Integration & Scenario Forecast track (CI-N, Phases 1–5)

This is the concrete, near-term delivery sequence already underway inside VinPoker Club Admin. It is
a lighter, **frontend-first / read-first** path that converges with the F1–F8 production-schema track
above — not a replacement for it. The CSV prototype (Data Readiness → Economics Mini Audit → Series
Workflow) shipped externally; this track brings the same value **natively** off existing VinPoker data
under existing RLS, one owner-gated PR at a time.

**Same locked principles apply:** one phase / one concern / owner-gated; controlled DB ops only (never
`deploy_db` in CI, never `supabase db push` from a normal push); read-first SECURITY DEFINER RPCs;
flag-gated (`clubSeriesIntelligence`). Nothing here computes profit, P&L, or a definite predicted
number; nothing here is a recommendation.

### Phase 1 — Native Data Inventory — **DONE (PR #325, merged)**
- **What:** a pure adapter (`src/lib/series-intelligence/nativeData.ts`) maps native `tournaments`
  rows into the Series Intelligence event shape, and a read-only hook (`useNativeSeriesEvents`) probes
  the owner's own clubs/tournaments under **existing RLS** (only `.select`, zero writes). The "Nguồn
  dữ liệu" section reports coverage: how many events have buy-in / fee / prize pool, and how many are
  missing GTD or missing entry counts.
- **Honesty:** never fabricates — GTD is always `null` and pushed to `missingFields`; entry counts are
  `null` until a server-derived source exists. No economics computed yet; inventory only.
- **Status:** merged. Descriptive coverage report live behind the flag.

### Phase 2 — Owner-scoped read RPC — **source-only (PR #327, in review)**
- **What:** `get_club_series_events(p_club_id, p_from, p_to)` — a SECURITY DEFINER / STABLE read RPC
  returning one descriptive row per tournament with **server-derived** entry counts.
- **Shape (descriptive only):** event id/name/date, `buy_in`, `fee = rake_amount`,
  `service_fee = service_fee_amount` (kept **separate**, never summed), `prize_pool_actual`,
  `total_entries` / `unique_entries` / `reentries`, `club_id`. `gtd` is `null` until Phase 3.
- **Counts source (audited canonical):** `tournament_registrations` with `status = 'confirmed'` —
  `total = count(*)`, `unique = count(distinct player_id)`, `reentries = total − unique`.
  `stack_registrations` (offline walk-in queue) and `tournament_entries` (seating record) are **not**
  used for counting.
- **Security:** owner-scope enforced inside the function (`clubs.owner_id = auth.uid()`, or
  `super_admin` via the existing `public.has_role` helper); `revoke … from public, anon`; `grant
  execute … to authenticated`. RLS is bypassed in a SECURITY DEFINER body, so ownership is checked
  explicitly.
- **No** profit / expected / forecast / overlay / prediction output columns.
- **Sequence:** merge **source-only** → a **separate owner-gated controlled-apply session** (preflight
  → snapshot → single-purpose apply via Management API / `db query --linked --file`, **not** `db push`
  → verify security/grants/owner-scope/cross-club-denied/counts → rollback note → regen `types.ts`) →
  then a **frontend hook-switch PR** flips `useNativeSeriesEvents` from `.select()` to `.rpc()`.

### Phase 3 — GTD schema + input
- **What:** add a nullable `tournaments.guarantee_amount numeric`; add a GTD input to the ClubAdmin
  tournament create/edit form; `CREATE OR REPLACE` the Phase 2 RPC to return `guarantee_amount as gtd`.
- **Honesty:** when GTD is `NULL`, readiness still reports "thiếu GTD"; GTD is **never** faked from
  `prize_pool`.
- **Owner-gate:** schema migration applied via a controlled op; flag + per-club enable unchanged.

### Phase 4 — Scenario Forecast Lite (rules-based, **not** a learned model)
- **What:** a frontend / rules-based **scenario simulator** over the club's own observed comparable
  events. The owner picks comparable events + adjustable assumptions (e.g. marketing push, calendar
  slot, guarantee level), and the tool shows **three transparent ranges**, not one number:
  **Conservative / Base / Upside (Boom)** — e.g. `80–110 / 110–150 / 150–220` entries.
- **Mandatory honesty on every scenario:** a **confidence** label, **missing-data** warnings, an
  **overlay risk** note, a **GTD risk** note, the **comparable-events basis** (which past events and how
  many), and a **"không phải cam kết / not a guarantee"** disclaimer.
- **What it is NOT:** not machine learning, not causal, not a point estimate, not a definite predicted
  number, not a recommendation to run the event. It is a what-if **range** computed deterministically
  from data the owner can see and from assumptions the owner sets — a **hypothesis**, bounded and
  labelled.
- **Why it is allowed before the Tier-3 deferral:** see §5 clarification — rules-based single-club
  ranges are not the deferred learned/causal capability.

### Phase 5 — Learned Forecast (post-pooled-data, = Tier-3)
- **What:** a learned model that estimates ranges from **pooled multi-club** historical data. This is
  the **same** capability the §5 Tier-3 deferral and F7 discipline gate cover.
- **Status:** deferred until pooled multi-club data exists; requires its own spec; outputs must carry
  confidence labels + explicit model-honesty wording. Not started, not scheduled.

### 6.1 Honesty language (locked for this track)

- **Use:** Scenario · Range · Simulation · Hypothesis · Confidence · Missing data · Conservative ·
  Base · Upside / Boom · comparable events · "không phải cam kết".
- **Avoid (false-certainty wording — never ship these):** "guaranteed prediction" · "chắc chắn" ·
  "exact forecast" · "AI knows the result" · `dự đoán` used as certainty · profit / expected /
  forecast presented as a single definite number.
- **Positioning:** VinPoker Series Intelligence helps a club owner see the **possible** upside,
  revenue potential, and overlay risk of a tournament or series **before publishing** — using native
  club data plus transparent scenario simulation. Sell the dream as **scenarios**, not false certainty.

### 6.2 Convergence with F1–F8

The Native track is the near-term, frontend-first path; F1–F8 is the deeper production-schema path
(`club_intel_*` tables, observations, rules engine, snapshots). They converge: the Phase 2 RPC is the
practical first instance of the F2 "native → observation adapter" idea; Phase 4 Scenario Forecast Lite
sits beside F6 (observed schedule draft) as an honesty-bounded what-if surface; Phase 5 is exactly the
F7 / Tier-3 forecast tier. Wording discipline and the controlled-ops / flag-gated rules are identical
across both tracks.
