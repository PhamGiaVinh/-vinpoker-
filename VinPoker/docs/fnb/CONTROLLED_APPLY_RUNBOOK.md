# F&B Module — Controlled-Apply Runbook (P0 → P8a, + where P6 plugs in)

> **Scope:** owner-gated controlled apply of the source-only F&B migrations on branch
> `agent/fnb-module` (worktree `D:/wt/fnb-module`). **NEVER** `supabase db push` / `db reset` /
> `migration up` / `deploy_db`. Apply via the **Management API** or `supabase db query --linked
> --file <path>` in a controlled session. `schema_migrations` is **not** touched. Regen `types.ts`
> as a **separate** step. The frontend (P8a) ships **dark** — every `FEATURES.fnb*` flag is `false`.
>
> **Golden rule for this module:** the finance RPC (P6) is cloned **byte-faithful from the LIVE
> dump** (`live_finance_rpc.sql`), never from a source migration. The live version already carries
> service-fee + rake online/offline/reentry + reconciliation; cloning from source would silently
> overwrite that and corrupt every club's P&L.

---

## 0. Pre-flight (read-only, no writes)

```sql
-- enum baseline (P0 adds 3 values to this)
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'app_role' ORDER BY e.enumsortorder;

-- helpers P1–P4 depend on already exist live
SELECT proname FROM pg_proc WHERE proname IN ('is_club_owner','has_role','trg_block_mutation');

-- pg_cron is enabled (P7)
SELECT 1 FROM pg_extension WHERE extname = 'pg_cron';

-- the live finance RPC (this is what P6 clones — dump it to live_finance_rpc.sql)
SELECT pg_get_functiondef('public.get_club_finance_summary(timestamptz,timestamptz,uuid)'::regprocedure);
```

Files to apply, in order, from `VinPoker/supabase/migrations/`:

| Step | File | Depends on | Gate after |
|---|---|---|---|
| P0 | `20261111000000_app_role_add_fnb.sql` | — | enum has 3 fnb values |
| P1 | `20261111000001_fnb_role.sql` | P0 | role helpers + grant/revoke authz |
| P2 | `20261111000002_fnb_core.sql` | P1 | tables + RLS SELECT-only + append-only triggers |
| P3 | `20261111000003_fnb_rpcs.sql` | P2 | atomic PAID / cancel / shipped / stock_in / stocktake |
| P4 | `20261111000004_fnb_admin_rpcs.sql` | P3 | admin upserts owner-only + report scope |
| P5 | `20261111000005_fnb_realtime.sql` | P2 | exactly 2 tables published |
| **P6** | `20261111000006_finance_summary_fnb.sql` | **live dump** | **golden-diff (see §P6)** |
| P7 | `20261111000007_fnb_expire_pending_cron.sql` | P2 | cron scheduled + sweep works |

> **Ordering note:** P0 must be applied **alone first** (Postgres can't use a new enum value in the
> same tx that added it). P6 and P7 are independent of each other; P6 is gated on the live dump, so
> P0→P5 + P7 can all be applied first, and P6 slotted in before flipping `fnbFinance` / any club's
> `fnb_in_club_net`.

Each migration file carries its own `BEGIN … ROLLBACK` test block + a ROLLBACK section — run the
test block in a transaction that you ROLLBACK, then apply for real.

---

## P0 — enum (apply ALONE, first)
Apply `20261111000000_app_role_add_fnb.sql`. Verify:
```sql
SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'app_role' AND enumlabel LIKE 'fnb_%' ORDER BY enumlabel;
-- EXPECT: fnb_cashier, fnb_kitchen, fnb_server
```

## P1 — role membership + helpers + grant/revoke
Apply `20261111000001_fnb_role.sql`. Verify (use the file's TEST PLAN with a fixture club/owner/staff):
```sql
SELECT proname FROM pg_proc WHERE proname IN
  ('is_club_fnb','is_club_fnb_kind','fnb_club_ids','fnb_grant_staff','fnb_revoke_staff');  -- 5 rows
-- authz: a non-owner calling fnb_grant_staff returns {"error":"Forbidden"} (no self-escalation)
-- a granted staff: is_club_fnb=true; is_club_fnb_kind(...,'cashier')=true for the cashier facet only
```

## P2 — core schema + RLS + append-only ledger
Apply `20261111000002_fnb_core.sql`. Verify:
```sql
-- 11 tables exist
SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'fnb_%';     -- 11
-- RLS is SELECT-only (only 'r' policies on fnb_* tables)
SELECT DISTINCT polcmd FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
WHERE c.relname LIKE 'fnb_%';                                                            -- only 'r'
-- append-only blocks mutation (run in a tx + ROLLBACK; service role / definer insert a probe row first)
--   UPDATE public.fnb_stock_movements SET delta=delta;  -- ERROR: This table is append-only
--   DELETE FROM public.fnb_order_events;                -- ERROR: This table is append-only
```

## P3 — money/stock RPCs (the critical patch)
Apply `20261111000003_fnb_rpcs.sql`. Run the file's TEST PLAN in a `BEGIN … ROLLBACK`:
- a server (no cashier facet) calling `fnb_mark_paid` → `{"error":"Forbidden"}`; a cashier → ok.
- second `fnb_mark_paid` on the same order → `idempotent:true`, exactly **one** `-N 'sale'` ledger row.
- an order needing more than `on_hand` → `ERROR INSUFFICIENT_STOCK`; `on_hand` unchanged.
- `fnb_cancel_order` on a `paid`-not-shipped order → `+N 'cancel_return'`; on a `shipped` order →
  refund only, **no** restock (unless `fnb_settings.restock_on_shipped_cancel=true`).
```sql
SELECT proname FROM pg_proc WHERE proname IN
  ('fnb_create_order','fnb_mark_paid','fnb_cancel_order','fnb_mark_shipped','fnb_stock_in','fnb_commit_stocktake'); -- 6
-- reconciliation invariant after any test:
SELECT i.id, i.on_hand, COALESCE(SUM(m.delta),0) AS ledger_sum
FROM public.fnb_ingredients i LEFT JOIN public.fnb_stock_movements m ON m.ingredient_id=i.id
GROUP BY i.id, i.on_hand HAVING i.on_hand <> COALESCE(SUM(m.delta),0);   -- EXPECT 0 rows
```

## P4 — admin RPCs + report
Apply `20261111000004_fnb_admin_rpcs.sql`. Verify (file SANITY block):
- a cashier calling `fnb_upsert_menu_item` / `fnb_update_settings` → `Forbidden` (owner-only).
- `fnb_set_recipe` full-replaces the BOM atomically (bad ingredient → whole call aborts, recipe unchanged).
- `fnb_get_report` for a club the caller isn't F&B/owner of → `forbidden`.

## P5 — realtime publication
Apply `20261111000005_fnb_realtime.sql`. Verify:
```sql
SELECT tablename FROM pg_publication_tables
WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename LIKE 'fnb_%';
-- EXPECT exactly: fnb_orders, fnb_order_items  (NO fnb_stock_movements / others)
```

## P6 — finance RPC (⛔ BLOCKED on the live dump; clone byte-faithful, prove golden-diff)
**Do NOT apply until `20261111000006_finance_summary_fnb.sql` is written from `live_finance_rpc.sql`.**
The migration = `CREATE OR REPLACE` of the **exact live body** (keep its `user_roles` super_admin
check, keep the `(timestamptz,timestamptz,uuid)` signature) + the 5 additive F&B hooks (CTE
`fnb_rows` JOIN `fnb_settings WHERE coalesce(fnb_in_club_net,false)` — per-club, no `bool_or`;
`rev_all` union; `revenue.fnb`; `cost.fnbCogs` + `net − Σ fnb_rows.cogs`; `trend`/`perClub` cogs +
spine; empty-scope `fnb:0`/`fnbCogs:0`).

**Golden-diff gate (mandatory before keeping P6):** with every club's `fnb_in_club_net = false`
(the default), the new function's output must equal the live output **except for the two additive
keys `revenue.fnb = 0` and `cost.fnbCogs = 0`** — no pre-existing value may change.
```sql
-- 1. BEFORE applying P6, capture the live output on a representative club + range:
--    SELECT public.get_club_finance_summary('2026-01-01','2026-12-31','<club>');   → save as OLD
-- 2. Apply P6 (CREATE OR REPLACE) in a tx you can ROLLBACK.
-- 3. Capture again: SELECT public.get_club_finance_summary('2026-01-01','2026-12-31','<club>'); → NEW
-- 4. Diff OLD vs NEW. PASS only if the ONLY difference is +"fnb":0 (in revenue) and +"fnbCogs":0
--    (in cost). Any change to total/net/rake/serviceFee/payroll/trend/perClub → FAIL → ROLLBACK.
```
Flip `fnb_settings.fnb_in_club_net = true` **per club** only after that club's F&B UAT passes.

## P7 — TTL cron
Apply `20261111000007_fnb_expire_pending_cron.sql`. Verify:
```sql
SELECT jobname, schedule FROM cron.job WHERE jobname='fnb-expire-pending';   -- '*/5 * * * *'
SELECT public.fnb_expire_pending_orders();    -- returns count of expired (0 if none stale)
-- a stale PENDING order → after the sweep: status='expired' + an 'expired' fnb_order_events row.
```

---

## Types regen (separate step, after the DB patches are live)
```bash
# from the worktree (with linked project), NOT a migration:
supabase gen types typescript --linked > src/integrations/supabase/types.ts
# or via the Management API types endpoint. Commit the regenerated types.ts on agent/fnb-module.
```

## Frontend flag flips (P10 — one-line commits, each after the matching backend is live + UAT)
`src/lib/featureFlags.ts`, in order:
1. `fnbModule: true` — master on (also enables the useAuth `club_fnb_staff` lookup; safe once P1 live).
2. `fnbCounter: true` — counter + table ordering (needs P2+P3+P4).
3. `fnbKitchen: true` — Kitchen Display (needs P5 realtime).
4. `fnbInventory: true` — ingredient/recipe/stock-in/stocktake admin tabs.
5. `fnbFinance: true` + per-club `fnb_settings.fnb_in_club_net = true` — F&B line in the Owner
   Finance dashboard (needs P6 live + golden-diff passed).

Each flip is reversible (kill-switch). Keep all `false` until each surface's backend is live + UAT'd.

---

## Rollback (per patch — drop children before parents)
Each migration file has a ROLLBACK section. Whole-module teardown order:
P7 cron (`cron.unschedule` + drop fn) → P6 (restore live body from `live_finance_rpc.sql`) →
P5 (`ALTER PUBLICATION … DROP TABLE`) → P4 fns → P3 fns → P2 tables (CASCADE) + enums →
P1 fns + `club_fnb_staff` + `fnb_role_kind` → P0 enum values stay (harmless, can't be dropped).
Frontend: set every `FEATURES.fnb*` back to `false` (instant dark).
```
