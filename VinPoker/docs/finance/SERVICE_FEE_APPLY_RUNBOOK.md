# Tournament SERVICE FEE (phí dịch vụ) — controlled apply runbook

A SECOND configured per-entry charge, separate from rake. Player price becomes
`buy_in + rake_amount + service_fee_amount`. **Everything ships flag-OFF and additive** — for every
existing tour `service_fee_amount = 0`, so there is **zero behavior/number change** until an owner
sets a service fee > 0 *and* the flag is on. Nothing here is applied automatically.

## Pieces (all source-only in this PR)
| Piece | File | Apply |
|---|---|---|
| Column | `supabase/migrations/20260915000000_tournaments_service_fee.sql` | owner-gated controlled op |
| Finance RPC v3 | `supabase/migrations/20260916000000_finance_summary_service_fee.sql` | owner-gated controlled op + golden diff |
| Online edge fn | `supabase/functions/tournament-register/index.ts` | deploys on merge (guarded — safe before column) |
| ClubAdmin inputs | `src/pages/ClubAdmin.tsx` | flag-gated UI |
| Cashier defaults | `OfflineBuyInPanel.tsx` / `ReentryPanel.tsx` | flag-gated default |
| Finance hook + dashboard | `useClubFinanceSummary.ts` / `ClubFinanceDashboard.tsx` | flag-gated / data-driven line |
| Flag | `src/lib/featureFlags.ts` → `tournamentServiceFee: false` | flip last |

## Hard safety
```
supabase db push:        NO
deploy_db=true:          NO
schema_migrations write: NO (controlled op records the row per precedent, never via db push)
payroll formula:         UNCHANGED (finance RPC is read-only / STABLE / zero writes)
existing tours:          UNCHANGED (service_fee_amount defaults 0 → serviceFee 0, rakeActual identical)
```

## Apply order (owner-gated — DB FIRST, then deploy, then flag)
The edge fn reads `service_fee_amount` with a **guarded** select (absent → 0), so deploy order is
safe either way; still, apply the column first to avoid any window.

```
1) Apply column migration 20260915000000  (controlled op)
   ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS service_fee_amount bigint NOT NULL DEFAULT 0;
   verify: column present, type bigint, default 0, NOT NULL.

2) Apply finance RPC migration 20260916000000  (controlled op)
   preflight: capture md5(pg_get_functiondef('public.get_club_finance_summary(timestamptz,timestamptz,uuid)'::regprocedure))
   CREATE OR REPLACE (body from the migration)
   verify: SECURITY DEFINER + STABLE + search_path=public; EXECUTE = authenticated only; anon/public revoked.
   GOLDEN DIFF: call get_club_finance_summary(from,to,club) for a known club BEFORE and AFTER.
     Expect IDENTICAL output except the new revenue.serviceFee:0 field (every existing tour has
     service_fee_amount=0). If any other number moves, STOP and roll back.

3) Merge the PR  (deploys the tournament-register edge fn + ships the flag-OFF frontend)

4) Flip the flag: FEATURES.tournamentServiceFee = true  (one-line commit) → owner UAT:
   - ClubAdmin → create/edit a tour → set "Phí dịch vụ" (e.g. 50.000) → save
   - Online + offline + re-entry register: player pays buy_in + rake + 50.000
   - Owner Finance: "Phí dịch vụ" line appears; "Thực thu (đối chiếu)" stays rake-only; total/net include service fee
```

## Rollback
- RPC: `CREATE OR REPLACE` back to the `20260905000000` body (drops serviceFee, restores
  `rakeActual = total_pay − buy_in`). The hook treats missing fields as 0 → safe.
- Column: `ALTER TABLE public.tournaments DROP COLUMN IF EXISTS service_fee_amount;`
  (new + unreferenced once the RPC is rolled back) — see
  `docs/emergency_rollbacks/PRE_SERVICE_FEE_20260915.sql`.
- Flag: set `tournamentServiceFee = false` to hide UI immediately (kill-switch).

## Reconciliation semantics (why rakeActual stays honest)
The registration writers fold the service fee into `total_pay`. The RPC's `rakeActual` subtracts the
per-entry `service_fee_amount` (`GREATEST(0, total_pay − buy_in − service_fee_amount)`) so it remains
**rake-only** and `rakeVariance = rakeActual − rake` keeps its meaning. The service fee is reported
as its own configured stream (`service_fee_amount × paying entries`), never derived from
`total_pay − buy_in`, so the two are never double-counted.
