# VinPoker Club Intelligence — Safety & Boundary Contract (CI-0.x)

**Status:** Binding contract. Applies to every phase (F1–F8) and to all output, schema, and UI.
If any item here conflicts with a build decision, this document wins.
**Companion docs:** [`FULL_VERSION_SPEC.md`](./FULL_VERSION_SPEC.md) · [`DATA_MODEL.md`](./DATA_MODEL.md) · [`ROADMAP.md`](./ROADMAP.md)

---

## 1. Forbidden claims (locked — verbatim)

The module MUST NOT, in any surface, string, export, or RPC output:

1. **No expected entries** — never present an expected/projected entry count as a system output.
2. **No projected profit** — never present profit, P&L, or ROI unless real line-item cost data
   exists and is modeled (it does not in F1–F8).
3. **No best / recommended schedule** — never present a "best", "optimal", or "recommended"
   schedule; there is no optimizer.
4. **No causality conclusion** — never assert cause-and-effect from observed data; correlations are
   `Hypothesis` only, with a "needs a controlled test" note. `cannibalization` is always
   `Hypothesis` until pooled multi-club data exists.
5. **No AI prediction** — the engine is deterministic and rules-based; there is no AI model and no
   prediction.

The single legal exception is `club_intel_forecasts.forecast_value`, which is an explicitly
**human-entered** number being *scored* — never a system output (see [`DATA_MODEL.md` §8](./DATA_MODEL.md)).

A copy/automated check SHOULD flag the strings `expected`, `projected`, `forecast` (outside the
shadow-input/disclaimer context), `optimal`, `best plan`, `recommend`, and `profit` in any rendered
output during F8 review.

## 2. Label discipline

- Every rendered insight carries **exactly one** label and a **non-empty provenance** string.
- Only `Known Rule` / `Observed Pattern` / `Hypothesis` may be emitted in F1–F8.
- `Tested Finding` and `Model Estimate` are reserved for the deferred LEARNED-CAUSAL tier and MUST
  NOT appear; the `ci_label_tier` write-guard enforces this.
- Hypotheses must state the next test and explicitly disclaim causality.

## 3. RLS model

- **Every `club_intel_*` table** has `ROW LEVEL SECURITY` enabled with a club-isolation policy,
  modeled on existing payroll/finance policies:
  `USING (club_id IN (SELECT club_id FROM club_members WHERE player_user_id = auth.uid()))`,
  with owner/super_admin reach via `is_club_owner(auth.uid(), club_id)`.
- **All read paths are SECURITY DEFINER read RPCs** with `SET search_path = public`, scoped by
  `club_id`, modeled on `get_club_finance_summary`.
- **Grants:** `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION … TO authenticated;`
  on every RPC (verbatim `is_club_owner` precedent). No anon, no cross-club, no service-role key in
  any client path.
- Cross-club access and anonymous access MUST be proven impossible during F1 and re-verified at F8.

## 4. Audit & immutability

- `club_intel_rule_runs` and `club_intel_report_snapshots` are **immutable** (no UPDATE/DELETE
  policy). Corrections supersede via a new row. A `locked` report snapshot raises an EXCEPTION on any
  write (payroll-period lock precedent).
- All mutations on `club_intel_*` are logged to `club_intel_audit_log` (shape mirrors
  `payroll_audit_log`: `old_values`/`new_values` JSON, `changed_by`, `changed_at`) via a SECURITY
  DEFINER trigger.
- Determinism is part of the contract: same facts + same `rule_set_version` ⇒ identical findings,
  so any rule run is replayable from `facts_json`.

## 5. CSV-import safety

- **Two-stage ingest:** parse → `club_intel_import_rows` (untrusted) → validate → promote to
  `club_intel_observations`. Nothing reaches observations un-promoted.
- **Caps at ingest:** 5 MB file / 2000 rows (prototype limits); excess is rejected with a clear
  message, never silently truncated.
- **Formula-injection escaping on export:** any export of import/observation/report data MUST escape
  cells beginning with `=`, `+`, `-`, `@`, TAB, or CR (prefix with `'`) so a spreadsheet does not
  execute them. Raw `raw_json` is data-only and never executed.

## 6. Secret & PII handling

- Observations and report snapshots store **no raw PII**; `player_id` is carried only where strictly
  required (e.g., reconciliation) and never surfaced in a report snapshot.
- No secrets, tokens, DB URLs, or service keys in CSV content, `app_settings`/`club_settings` flag
  values, or any doc. Flag values are non-sensitive booleans/strings.
- If a secret ever appears in transcript, logs, or repo, report it and recommend rotation
  (per project Supabase ops rules).

## 7. Honesty boundaries restated

- **Schedule Draft** re-orders only observed combos; it never invents a combo and never recommends.
- **Shadow Forecast Lab** scores only human forecasts; the system never forecasts.
- **Pricing/Rake** shows observed structure only; no profit without real cost data.
- **Descriptive** states what happened, with sample sizes, never why.
- **Owner Report** re-expresses engine output; it is a briefing to review, not a decision.

## 8. Per-phase enforcement checklist

Each F-phase must prove, before its owner-gate:

- [ ] Club-scope holds (no cross-club, no anon) for every new table/RPC.
- [ ] Every new output carries a valid label + non-empty provenance.
- [ ] No forbidden-claim string appears in any rendered output (§1).
- [ ] Audit log is populated for every mutation; immutable tables reject edits.
- [ ] CSV paths honor staging + caps + export escaping (where touched).
- [ ] No `deploy_db`/`db push` in CI; migrations applied via controlled ops with rollback notes.

**F8 runs the full checklist as its exit gate.**
