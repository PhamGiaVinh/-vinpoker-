# Close Table Canonical Controlled Apply

This runbook is preparation only. Do not execute it without a separate owner
gate confirming backup/restore readiness and the exact target environment.

## Pre-Apply Read-Only Evidence

Save timestamped output for:

```sql
select pg_get_functiondef(
  'public.close_tournament_table(uuid,text,text)'::regprocedure
);

select
  p.oid::regprocedure,
  r.rolname as owner,
  p.prosecdef,
  p.proconfig,
  p.proacl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_roles r on r.oid = p.proowner
where n.nspname = 'public'
  and p.proname = 'close_tournament_table';
```

Also capture the migration ledger maximum, overload count, active tournament
tables, active unlinked/mismatched source seats, and active hands on canonical
or physical table identity. Save the exact function definition, owner, and
grants as the rollback artifact.

## Controlled Apply

Apply only:

```text
20270106000003_close_table_canonical_contract.sql
```

Never use `supabase db push --include-all`, migration repair, manual ledger
insert, or pending migration application. No production RPC write smoke is
allowed unless the owner separately authorizes a newly created TEST tournament.

## Post-Apply Verification

Verify read-only:

- the new ledger version is present exactly once;
- exactly one overload exists;
- owner is `postgres`;
- `SECURITY DEFINER` and `search_path=public` remain;
- grants remain `authenticated`, `postgres`, and `service_role`;
- Floor authorization, both seat guards, active-hand blocker, idempotent
  already-closed response, dealer release, and mover-local conservation exist;
- the reviewed semantic hash matches the applied body.

## Rollback

Rollback restores the exact saved pre-apply function definition, owner, and
grants in one owner-controlled transaction. Record rollback as a forward
action according to repository convention. Never delete or rewrite migration
ledger history.
