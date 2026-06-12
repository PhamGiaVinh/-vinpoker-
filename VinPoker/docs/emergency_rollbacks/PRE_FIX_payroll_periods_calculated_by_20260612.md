# PRE-FIX SNAPSHOT — payroll_periods.calculated_by drift (2026-06-12)

**Operation:** fix_payroll_periods_calculated_by_column (Level 3 controlled patch)
**Target DB:** linked Supabase project `orlesggcjamwuknxwcpk` (remote test DB)

## Problem

`save_payroll_period` (live, SECURITY DEFINER — body matches committed migrations
20260716000000 → 20260801000000 line) executes:

```sql
INSERT INTO payroll_periods (club_id, period_year, period_month, period_start, period_end, status, calculated_by)
...
UPDATE payroll_periods SET calculated_by = p_user_id, updated_at = now() ...
```

but the live `payroll_periods` table has NO `calculated_by` column → every save fails:

```
POST /rest/v1/rpc/save_payroll_period → 400
SQLSTATE 42703: column "calculated_by" of relation "payroll_periods" does not exist
```

Discovered during PR #13 saved-path UAT (2026-06-12). Pre-existing backend drift —
unrelated to PR #13 (frontend-only).

## Preflight evidence (read-only, 2026-06-12)

```
payroll_periods.calculated_by exists:  false
dealer_payroll.calculated_by exists:   true   (hand-applied hotfix, never committed)
save_payroll_period references column: true
repo migration defining the column:    NONE (grep across supabase/migrations/)
```

Live `payroll_periods` columns before fix:

```
id, club_id, period_year, period_month, period_start, period_end, status,
locked_at, locked_by, created_at, submitted_by, submitted_at, approved_by,
approved_at, updated_at, rejected_by, rejected_at, rejection_reason
```

## Fix applied (single idempotent DDL, manual apply — NOT via db push)

```sql
ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS calculated_by UUID;
```

Source-only migration committing the same statement:
`supabase/migrations/20260815000001_payroll_periods_calculated_by.sql`

## Rollback

Column is new and starts fully NULL; nothing reads it except the function's own
INSERT/UPDATE writes. If rollback is ever required:

```sql
ALTER TABLE public.payroll_periods DROP COLUMN IF EXISTS calculated_by;
```

(Only safe while no business logic depends on stored values.)

## Constraints honored

- deploy_db=true used: NO
- supabase db push used: NO
- schema_migrations changed: NO
- pending migrations applied: NO
- no other table touched, no RPC body changed, no formula change
