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
cannibalization, pricing-response, profit/risk models, forecast ranges) is **post-F8** and requires
its own spec. Until then, cannibalization remains `Hypothesis` and the last two labels stay reserved.
