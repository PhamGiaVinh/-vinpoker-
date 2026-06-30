# PR-E — CUSTOM payout templates + Excel/CSV import · controlled apply runbook

Source-only PR. **No DB apply, no Edge deploy, no flag flip in the PR.** Two features added to the
CUSTOM payout flow, both gated behind `FEATURES.payoutCustomTemplates` (default **OFF**):

1. **Import Excel/CSV** — client-side only (`src/lib/customPayoutImport.ts`, deps `xlsx`/`papaparse`
   already installed, dynamic-imported). Works the moment the flag is on; **needs no DB**.
2. **Save/load templates** — uses the existing `payout_templates` table via RLS direct CRUD
   (owner/admin write, owner/admin/cashier read). **Needs migration `20261126000000`** first.

## Order (each step owner-gated)
1. **Merge** the source-only PR. CI deploys the frontend (Vercel) — the new UI stays **dark**
   (`payoutCustomTemplates=false`). `compute-payouts` is unchanged (not in the CI deploy list, and
   this PR doesn't touch it). Preset/CUSTOM closes keep working.
2. **DB dry-run** — Management API `BEGIN … ROLLBACK`: prepend `20261126000000_payout_custom_templates.sql`,
   assert (a) CHECK now allows `CUSTOM`, (b) `custom_percents` column exists, (c) a CUSTOM template
   inserts + reads back, (d) a preset (DAILY) template still inserts (regression), then ROLLBACK.
3. **DB apply** — owner phrase → `BEGIN … COMMIT` of `20261126000000` only. Do **not** write
   `schema_migrations` (stays `20260926000000`). No `db push`.
4. **Flip `FEATURES.payoutCustomTemplates = true`** (separate one-line PR) — the import + save/load UI
   appears inside the CUSTOM builder, for clubs already on the `payoutEngine` allowlist (club
   `22222222`). **No allowlist widening, no other flag touched.**
5. **UAT** on club `22222222`: upload a sample %-sheet and a money-sheet (auto-detect), save a named
   template, reload it into another tournament, close a CUSTOM payout from a loaded template.

## Dry-run asserts — BEGIN … ROLLBACK
```sql
BEGIN;
-- (20261126000000 prepended in the controlled dry-run)
-- 1) constraint def of payout_templates_archetype_check now contains 'CUSTOM';
-- 2) information_schema shows payout_templates.custom_percents = jsonb;
-- 3) INSERT a CUSTOM template (archetype='CUSTOM', custom_percents='[{"position":1,"percent_bp":6000},
--    {"position":2,"percent_bp":3000},{"position":3,"percent_bp":1000}]', itm_percent=0, min_cash_x=2,
--    rounding_unit=100000) under a real club_id → succeeds; SELECT back custom_percents == input;
-- 4) INSERT a preset DAILY template (custom_percents NULL) → still succeeds (regression);
-- 5) cleanup happens via ROLLBACK.
ROLLBACK;
```

## Rollback / kill-switch
- **Instant:** `FEATURES.payoutCustomTemplates = false` → import + save/load hidden; payout_templates
  untouched for CUSTOM. CUSTOM payouts themselves keep working (unaffected).
- **DB:** the widened CHECK + nullable `custom_percents` are harmless to leave; to fully revert, run the
  down-migration in the SQL header (drop column, narrow CHECK) only if no CUSTOM template rows exist.

## Notes
- `payout_templates` WRITE is **owner/admin only** (per the 20261120 RLS); cashiers can **load** a saved
  template but a save attempt surfaces a friendly "Chỉ Chủ CLB/Admin mới lưu được mẫu."
- Import auto-detects % vs money (sum≈100 & max≤100 → %, else money→%), tolerates VN/EN number
  formats, drops header + trailing-total rows, normalises to Σ=100% (residual on rank 1), and warns on
  non-descending input. The operator always reviews the filled builder before preview/close.
