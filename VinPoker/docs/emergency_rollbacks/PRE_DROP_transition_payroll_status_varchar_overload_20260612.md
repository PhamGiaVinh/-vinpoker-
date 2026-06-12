# PRE-DROP SNAPSHOT — transition_payroll_status varchar overload (2026-06-12)

**Operation:** fix_transition_payroll_status_overload_ambiguity (Level 3 controlled patch)
**Target DB:** linked Supabase project `orlesggcjamwuknxwcpk` (remote test DB)

## Problem

Two live overloads coexist:

```
transition_payroll_status(uuid, varchar, varchar, uuid)            -- old, from 20260716000000, md5 4c056efdf2efee7e73677d743d512377
transition_payroll_status(uuid, text, text, uuid, text DEFAULT)    -- canonical, from 20260724000000, md5 4ef5ba3ab58c6462aab3f013de0bd730
```

`20260724000000_payroll_reject_flow.sql` CREATEd the new 5-param signature but never
DROPped the old 4-param varchar one. Every PostgREST call with 4 named args
(submit/approve/lock from `useDealerPayroll.ts`) is ambiguous:

```
Could not choose the best candidate function between:
  public.transition_payroll_status(p_period_id => uuid, p_expected_status => character varying, ...)
  public.transition_payroll_status(p_period_id => uuid, p_expected_status => text, ..., p_rejection_reason => text)
```

→ the entire payroll approval lifecycle (submit/approve/lock) is broken. Found during
saved-path UAT Case 3 (2026-06-12). Pre-existing — unrelated to PR #13/#18.

## Preflight evidence (read-only, 2026-06-12)

- Frontend: all 5 call sites in `src/hooks/useDealerPayroll.ts` use named args; none can or
  does pin the varchar overload. No Edge Function references the RPC.
- The 5-param text overload contains all transitions (draft/submitted/approved/locked/rejected)
  and `p_rejection_reason DEFAULT NULL` covers the 4-arg calls once it is the only candidate.
- `schema_migrations` count before write: 265. No pending state touched.

## Fix applied (single statement, manual apply — NOT via db push)

```sql
DROP FUNCTION IF EXISTS public.transition_payroll_status(uuid, varchar, varchar, uuid);
```

Source-only migration: `supabase/migrations/20260815000002_drop_transition_payroll_status_varchar_overload.sql`

## Rollback

Re-create the old overload verbatim from the snapshot (exact `pg_get_functiondef` output,
md5 `4c056efdf2efee7e73677d743d512377`):

```
docs/emergency_rollbacks/PRE_DROP_transition_payroll_status_varchar_overload_20260612.sql
```

(Re-creating it re-introduces the ambiguity bug — rollback only if the 5-param overload
proves defective.)

## Constraints honored

- deploy_db=true used: NO
- supabase db push used: NO
- schema_migrations changed: NO
- canonical 5-param overload NOT touched
- no formula, frontend, B5/B7, payment-lifecycle change
