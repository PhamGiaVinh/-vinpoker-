-- F&B module (FNB-P2) — core schema + RLS + append-only ledger/audit. DEPENDS ON 000000 + 000001.
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply 000000 → 000001 → THIS in a controlled
-- session (Management API / `supabase db query --linked --file`, NOT `db push` / not deploy_db).
-- Regen types.ts in a SEPARATE step. schema_migrations is NOT touched.
--
-- DESIGN (P0 rules from the approved plan):
--   P0-1  No client writes on ANY F&B table. Clients only SELECT (RLS); ALL mutations go through the
--         SECURITY DEFINER RPCs in 000003/000004 (they run as the function owner and bypass RLS for
--         their own statements). So every table gets ENABLE RLS + REVOKE ALL + GRANT SELECT + a
--         SELECT-only policy, and NO insert/update/delete policy.
--   P0-2  Money/stock movement is APPEND-ONLY: fnb_stock_movements + fnb_order_events reuse the
--         existing public.trg_block_mutation() to block UPDATE + DELETE (truth/audit is the ledger).
--   P0-3  Idempotency anchors: fnb_orders.client_request_id UNIQUE(club_id, client_request_id);
--         fnb_stock_movements + fnb_stocktakes carry a partial-unique client_request_id.
--   P0-4  COGS precision: fnb_order_items.unit_cost_snapshot is NUMERIC (not bigint) to avoid
--         sub-đồng truncation; the rounded order-level total lives in fnb_orders.cogs_vnd (bigint).
--   P0-5  Status is a Postgres ENUM (no free-text order state).
--   P0-6  club_id is denormalized onto every child table so RLS is a single uniform predicate.
--
-- Realtime publication for fnb_orders + fnb_order_items is DEFERRED to 000005 (its own gate).
-- Additive + idempotent. No cross-module FK/write into Cashier, Payroll, Tracker, Dealer Swing,
-- the online engine, or Tournament structure — F&B only references public.clubs + auth.users.

-- ===========================================================================================
-- 0. Enums (new types — safe to create here; fnb_role_kind already exists from 000001).
-- ===========================================================================================
DO $$ BEGIN
  CREATE TYPE public.fnb_order_status AS ENUM ('pending', 'paid', 'shipped', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.fnb_order_source AS ENUM ('table', 'counter');   -- flow A vs flow B
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.fnb_stock_reason AS ENUM
    ('stock_in', 'sale', 'cancel_return', 'stocktake_adjust', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================================
-- 1. Tables
-- ===========================================================================================

-- 1a. fnb_settings — one row per club; per-club policy switches (mutable via RPC only).
CREATE TABLE IF NOT EXISTS public.fnb_settings (
  club_id                   uuid NOT NULL PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  pending_ttl_secs          int  NOT NULL DEFAULT 900  CHECK (pending_ttl_secs > 0),   -- PENDING auto-expire
  restock_on_shipped_cancel boolean NOT NULL DEFAULT false,  -- owner-confirmed: shipped-cancel = refund only
  fnb_in_club_net           boolean NOT NULL DEFAULT false,  -- #F: include F&B (rev - COGS) in club Net
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid
);

-- 1b. fnb_categories
CREATE TABLE IF NOT EXISTS public.fnb_categories (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id    uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name       text NOT NULL,
  sort_order int  NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fnb_categories_name_uq UNIQUE (club_id, name)
);

-- 1c. fnb_menu_items — the sellable product; price_vnd is the source of truth read server-side at PAID.
CREATE TABLE IF NOT EXISTS public.fnb_menu_items (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id     uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.fnb_categories(id) ON DELETE SET NULL,
  name        text NOT NULL,
  price_vnd   bigint NOT NULL DEFAULT 0 CHECK (price_vnd >= 0),
  is_active   boolean NOT NULL DEFAULT true,      -- soft-disable; orders still reference it
  image_url   text,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fnb_menu_items_name_uq UNIQUE (club_id, name)
);
CREATE INDEX IF NOT EXISTS idx_fnb_menu_club_cat ON public.fnb_menu_items(club_id, category_id);
CREATE INDEX IF NOT EXISTS idx_fnb_menu_club_active ON public.fnb_menu_items(club_id, is_active);

-- 1d. fnb_ingredients — stock keystone. on_hand is materialized; truth/audit is fnb_stock_movements.
--     WMA cost in avg_unit_cost (per stock_unit). #C unit conversion via units_per_purchase.
CREATE TABLE IF NOT EXISTS public.fnb_ingredients (
  id                  uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id             uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name                text NOT NULL,
  stock_unit          text NOT NULL,                       -- the unit we stock/sell/deduct in (e.g. 'lon','g','ml')
  purchase_unit       text,                                -- the unit we buy in (e.g. 'thùng'); null = same as stock_unit
  units_per_purchase  numeric NOT NULL DEFAULT 1 CHECK (units_per_purchase > 0),  -- #C ratio
  on_hand             numeric NOT NULL DEFAULT 0,          -- #A=BLOCK keeps this >= 0 in practice; ledger is truth
  avg_unit_cost       numeric NOT NULL DEFAULT 0 CHECK (avg_unit_cost >= 0),      -- #B WMA per stock_unit
  low_stock_threshold numeric NOT NULL DEFAULT 0,
  version             int NOT NULL DEFAULT 0,              -- optimistic lock companion (mirrors chip bank)
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fnb_ingredients_name_uq UNIQUE (club_id, name)
);
CREATE INDEX IF NOT EXISTS idx_fnb_ing_club_active ON public.fnb_ingredients(club_id, is_active);

-- 1e. fnb_recipe_items — BOM: menu item -> ingredient + qty (in stock_unit) per 1 item.
CREATE TABLE IF NOT EXISTS public.fnb_recipe_items (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id       uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  menu_item_id  uuid NOT NULL REFERENCES public.fnb_menu_items(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES public.fnb_ingredients(id) ON DELETE RESTRICT,
  qty           numeric NOT NULL CHECK (qty > 0),
  CONSTRAINT fnb_recipe_uq UNIQUE (menu_item_id, ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_fnb_recipe_ingredient ON public.fnb_recipe_items(ingredient_id);

-- 1f. fnb_orders — lifecycle pending -> paid -> shipped (+ cancelled / expired).
CREATE TABLE IF NOT EXISTS public.fnb_orders (
  id                uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id           uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  status            public.fnb_order_status NOT NULL DEFAULT 'pending',
  source            public.fnb_order_source NOT NULL,
  table_label       text,                                  -- #E: 1 order = 1 table = 1 payment (free text in v1)
  note              text,
  customer_name     text,
  subtotal_vnd      bigint NOT NULL DEFAULT 0,             -- server-computed, frozen at PAID
  cogs_vnd          bigint NOT NULL DEFAULT 0,             -- server-computed at PAID = round(sum qty*unit_cost_snapshot)
  client_request_id text NOT NULL DEFAULT gen_random_uuid()::text,
  created_by        uuid DEFAULT auth.uid(),
  paid_by           uuid,
  paid_at           timestamptz,
  shipped_at        timestamptz,
  cancelled_by      uuid,
  cancelled_at      timestamptz,
  cancel_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fnb_orders_crid_uq UNIQUE (club_id, client_request_id)   -- idempotency anchor
);
CREATE INDEX IF NOT EXISTS idx_fnb_orders_club_status ON public.fnb_orders(club_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_fnb_orders_club_paid ON public.fnb_orders(club_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_fnb_orders_pending ON public.fnb_orders(club_id, status) WHERE status = 'pending';

-- 1g. fnb_order_items — immutable line snapshot (price + COGS frozen at PAID).
CREATE TABLE IF NOT EXISTS public.fnb_order_items (
  id                  uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id            uuid NOT NULL REFERENCES public.fnb_orders(id) ON DELETE CASCADE,
  club_id             uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,   -- denorm for RLS
  menu_item_id        uuid NOT NULL REFERENCES public.fnb_menu_items(id) ON DELETE RESTRICT,
  name_snapshot       text NOT NULL,
  qty                 int  NOT NULL CHECK (qty > 0),
  unit_price_snapshot bigint NOT NULL DEFAULT 0,           -- #D revenue, frozen at PAID
  unit_cost_snapshot  numeric NOT NULL DEFAULT 0,          -- #D COGS (NUMERIC to avoid sub-đồng truncation)
  line_status         public.fnb_order_status NOT NULL DEFAULT 'pending',
  shipped_at          timestamptz,
  CONSTRAINT fnb_order_items_uq UNIQUE (order_id, menu_item_id)
);
CREATE INDEX IF NOT EXISTS idx_fnb_oi_club_status ON public.fnb_order_items(club_id, line_status);

-- 1h. fnb_stock_movements — APPEND-ONLY ledger (every +/- to on_hand). Truth of inventory.
CREATE TABLE IF NOT EXISTS public.fnb_stock_movements (
  id                uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id           uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  ingredient_id     uuid NOT NULL REFERENCES public.fnb_ingredients(id) ON DELETE RESTRICT,
  delta             numeric NOT NULL,                      -- signed: +stock_in/+cancel_return, -sale
  reason            public.fnb_stock_reason NOT NULL,
  unit_cost         numeric,                               -- cost per stock_unit at the time of the movement
  balance_after     numeric,                               -- on_hand AFTER this movement (audit/reconcile)
  ref_type          text,                                  -- 'order' | 'stocktake' | 'manual'
  ref_id            uuid,                                  -- soft pointer (NO FK — keep the ledger clean)
  client_request_id text,
  actor             uuid DEFAULT auth.uid(),
  details           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fnb_stock_ing ON public.fnb_stock_movements(club_id, ingredient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fnb_stock_ref ON public.fnb_stock_movements(ref_type, ref_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fnb_stock_crid
  ON public.fnb_stock_movements(club_id, client_request_id) WHERE client_request_id IS NOT NULL;

-- 1i. fnb_order_events — APPEND-ONLY status-transition audit.
CREATE TABLE IF NOT EXISTS public.fnb_order_events (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id   uuid NOT NULL REFERENCES public.fnb_orders(id) ON DELETE CASCADE,
  club_id    uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,   -- denorm for RLS
  action     text NOT NULL,                                -- created|paid|shipped|line_shipped|cancelled|expired
  old_status public.fnb_order_status,
  new_status public.fnb_order_status,
  actor      uuid DEFAULT auth.uid(),
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fnb_order_events_order ON public.fnb_order_events(order_id, created_at);

-- 1j. fnb_stocktakes (+ lines) — physical count session; commit applies adjustments to the ledger.
CREATE TABLE IF NOT EXISTS public.fnb_stocktakes (
  id                uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id           uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  note              text,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'committed')),
  created_by        uuid DEFAULT auth.uid(),
  committed_by      uuid,
  committed_at      timestamptz,
  client_request_id text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fnb_stocktake_crid
  ON public.fnb_stocktakes(club_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fnb_stocktakes_club_status ON public.fnb_stocktakes(club_id, status);

CREATE TABLE IF NOT EXISTS public.fnb_stocktake_lines (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stocktake_id  uuid NOT NULL REFERENCES public.fnb_stocktakes(id) ON DELETE CASCADE,
  club_id       uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,   -- denorm for RLS
  ingredient_id uuid NOT NULL REFERENCES public.fnb_ingredients(id) ON DELETE RESTRICT,
  counted_qty   numeric NOT NULL,
  expected_qty  numeric,                                   -- snapshot at line entry (informational)
  delta_applied numeric,                                   -- set at commit (recomputed under lock)
  CONSTRAINT fnb_stocktake_lines_uq UNIQUE (stocktake_id, ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_fnb_stl_ingredient ON public.fnb_stocktake_lines(ingredient_id);

-- ===========================================================================================
-- 2. Append-only enforcement (reuse public.trg_block_mutation() — DROP IF EXISTS for idempotency).
-- ===========================================================================================
DROP TRIGGER IF EXISTS fnb_stock_no_update ON public.fnb_stock_movements;
CREATE TRIGGER fnb_stock_no_update BEFORE UPDATE ON public.fnb_stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_mutation();
DROP TRIGGER IF EXISTS fnb_stock_no_delete ON public.fnb_stock_movements;
CREATE TRIGGER fnb_stock_no_delete BEFORE DELETE ON public.fnb_stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_mutation();

DROP TRIGGER IF EXISTS fnb_order_events_no_update ON public.fnb_order_events;
CREATE TRIGGER fnb_order_events_no_update BEFORE UPDATE ON public.fnb_order_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_mutation();
DROP TRIGGER IF EXISTS fnb_order_events_no_delete ON public.fnb_order_events;
CREATE TRIGGER fnb_order_events_no_delete BEFORE DELETE ON public.fnb_order_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_mutation();

-- ===========================================================================================
-- 3. RLS — SELECT-only for clients; ALL writes go through the SECURITY DEFINER RPCs (000003/000004).
--    Uniform predicate: caller is F&B staff at the club OR the club owner (covers super_admin via
--    is_club_owner). No INSERT/UPDATE/DELETE policy anywhere → default deny for direct client writes.
-- ===========================================================================================
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'fnb_settings','fnb_categories','fnb_menu_items','fnb_ingredients','fnb_recipe_items',
    'fnb_orders','fnb_order_items','fnb_stock_movements','fnb_order_events',
    'fnb_stocktakes','fnb_stocktake_lines'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated;', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (public.is_club_fnb(auth.uid(), club_id) OR public.is_club_owner(auth.uid(), club_id));',
      t || '_select', t
    );
  END LOOP;
END $$;

-- ===========================================================================================
-- Controlled-apply SANITY (after 000000 + 000001 + this; run in a tx + ROLLBACK).
--   -- append-only blocks mutation:
--   BEGIN;
--     INSERT INTO public.fnb_stock_movements(club_id, ingredient_id, delta, reason)
--       VALUES ('<club>','<ing>', 1, 'manual');           -- via service role / definer only
--     UPDATE public.fnb_stock_movements SET delta = 2;     -- EXPECT: ERROR 'This table is append-only'
--     DELETE FROM public.fnb_stock_movements;              -- EXPECT: ERROR 'This table is append-only'
--   ROLLBACK;
--   -- RLS is SELECT-only (no client write policy):
--   SELECT polcmd, polname FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
--     WHERE c.relname LIKE 'fnb_%';                        -- EXPECT only 'r' (SELECT) policies.
-- ===========================================================================================
--
-- ===========================================================================================
-- ROLLBACK (undo this migration — drop children before parents):
--   DROP TABLE IF EXISTS public.fnb_stocktake_lines, public.fnb_stocktakes,
--     public.fnb_order_events, public.fnb_stock_movements, public.fnb_order_items,
--     public.fnb_orders, public.fnb_recipe_items, public.fnb_ingredients,
--     public.fnb_menu_items, public.fnb_categories, public.fnb_settings CASCADE;
--   DROP TYPE IF EXISTS public.fnb_stock_reason;
--   DROP TYPE IF EXISTS public.fnb_order_source;
--   DROP TYPE IF EXISTS public.fnb_order_status;
--   -- (the append-only triggers drop with their tables; fnb_role_kind belongs to 000001.)
-- ===========================================================================================
