# Payroll P4b Phase 1 — controlled apply runbook

Owner-gated apply of the two **additive** config tables (`insurance_policy_rates`,
`dealer_insurance_profiles`, migration `20260910000000`). **Phase 1 changes NO payroll
numbers** and does **not** touch `calculate_dealer_payroll`. Run via the allowlisted runner:

```
scripts/payroll/apply_p4b_phase1_insurance_tables.mjs
```

The runner hardcodes the one allowlisted migration, safety-scans it every run (refuses
payroll-fn / DML / seed / CREATE FUNCTION / ALTER on non-P4b tables / DROP TABLE), wraps the
file content in `BEGIN … COMMIT/ROLLBACK` (Management SQL API has no `\i`), masks secrets,
and **never** writes `schema_migrations` or seeds data.

## Credentials (never commit / print)
```
SUPABASE_PROJECT_REF   = <project ref>
SUPABASE_ACCESS_TOKEN  = <Supabase Management API token>
```
With no creds the runner prints the env names and exits 0 — it contacts nothing.

## Steps (in order)
```bash
# 1) preflight — read-only. Capture the calculate_dealer_payroll md5 it prints.
node scripts/payroll/apply_p4b_phase1_insurance_tables.mjs --preflight
#    expect: slot 20260910000000 registered = 0 · P4b tables live = 0

# 2) dry-run — BEGIN … migration … ROLLBACK (nothing persisted).
node scripts/payroll/apply_p4b_phase1_insurance_tables.mjs --dry-run
#    expect: tables_created=2 · policies_created=5 · triggers_created=2 · persisted after rollback=0

# 3) apply — owner-gated. Requires the explicit confirm env:
CONFIRM_APPLY_P4B_PHASE1=APPLY_P4B_PHASE1_INSURANCE_TABLES \
  node scripts/payroll/apply_p4b_phase1_insurance_tables.mjs --apply
#    BEGIN … migration … COMMIT. schema_migrations NOT written. Auto-runs post-verify
#    and asserts the payroll-fn md5 is unchanged vs the preflight capture.

# 4) post-verify (standalone re-check; pass the preflight md5 to assert no change):
EXPECTED_PAYROLL_FN_MD5=<md5 from step 1> \
  node scripts/payroll/apply_p4b_phase1_insurance_tables.mjs --post-verify
#    expect: 2 tables live · RLS on both · 5 policies · 2 triggers · slot registered=0 · md5 UNCHANGED
```

## After apply
- (Optional) seed 2026 region rates — **separate**, confirm figures first:
  `scripts/payroll/seed_insurance_policy_rates_2026.sql` (4 rows; `bhtn_cap_vnd = 20× min wage`).
- Flip `FEATURES.insuranceProfiles` → true → owner visual UAT of `/club/admin/insurance`.

## Rollback
`docs/emergency_rollbacks/PRE_P4b_PHASE1_20260910000000.sql` —
`DROP TABLE IF EXISTS public.dealer_insurance_profiles CASCADE;` then
`DROP TABLE IF EXISTS public.insurance_policy_rates CASCADE;` (tables are new + unreferenced).

## Hard guarantees
```
DB apply default:        NO  (apply needs the confirm env)
supabase db push:        NO   ·   deploy_db=true: NO
schema_migrations write: NO  (runner never inserts a row)
seed data:               NO  (seed is a separate, owner-applied script)
calculate_dealer_payroll:NO change (safety scan refuses; post-verify asserts md5)
credentials in repo:     NONE (env only; masked in logs)
```
