-- Series Intelligence — Theory Patch v2 (capture-column pre-provision).
--
-- SOURCE-ONLY migration. NOT applied live in this PR. The owner reads the SQL and applies it later in a
-- controlled session (Management API / `supabase db query --linked --file`, NOT `db push`, NOT deploy_db),
-- then regen types.ts in a SEPARATE step. schema_migrations is NOT touched by the controlled apply.
--
-- WHY: pre-provisions the capture columns that the (separate, Codex-owned) theory-patch-v2 UI increments will
-- WRITE/READ. Columns ONLY — no model, no calculation, no Edge, no trigger, no new table. No RLS/grant change:
-- every column lands on a table the intended writer ALREADY has a policy for, so nothing new is granted.
--
--   TP5  series_forecast_snapshots += rival_major_event_same_day boolean, rival_gtd bigint (>= 0)
--          → the pre-event snapshot records "a rival club runs a major event the same day" + that rival's GTD,
--            as KNOWN-BEFORE-THE-EVENT context (never a result). Owner-written via the existing sfs_insert policy.
--   TP6  series_forecast_snapshots += capacity integer (>= 0)      [pre-event owner input]
--        series_decision_logs      += hit_capacity boolean          [post-event owner outcome]
--          → capacity = the venue/seat capacity known at forecast time (owner input, exactly like rival_gtd, so
--            it lives WITH the snapshot). hit_capacity = "did the event reach capacity" — a post-event fact the
--            owner records via the existing sdl_update path, alongside the other actual_* fields.
--          → NOTE (targeting fix): these do NOT go on series_event_actuals. That table is SYSTEM-write-only
--            (authenticated has SELECT only; its sole policy is sea_select), and the autosync writer is not
--            modified here and has no source for a seat capacity — so a column there would strand NULL forever.
--            Homing capacity/hit_capacity on the owner-writable snapshot/decision tables keeps TP6 usable.
--            (Coordination: Codex's TP6 UI must target these tables, not series_event_actuals.)
--   TP9  series_decision_logs      += is_shadow boolean NOT NULL DEFAULT false
--          → marks a SHADOW (dry-run / not-acted-on) decision row so shadow recommendations are recorded for
--            scoring without being confused with real owner decisions. Existing rows backfill to false.
--
-- LEAKAGE RULE (locked, unchanged): rival_* / capacity / hit_capacity are context/actuals for SCORING and
-- known-before framing; they are NEVER fed back as forecast model inputs. is_shadow is bookkeeping.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS (+ a named column CHECK, added atomically with the column so a re-run
-- that skips the existing column also skips the constraint — no duplicate). A future gated re-apply is a safe
-- no-op. PREREQUISITE: series_capture_v0 (20261125000000) is applied (both target tables must exist); this
-- migration only ALTERs them.

-- TP5 rival-context + TP6 capacity — all pre-event owner inputs on the forecast snapshot (rival_gtd/capacity >= 0).
ALTER TABLE public.series_forecast_snapshots
  ADD COLUMN IF NOT EXISTS rival_major_event_same_day boolean,
  ADD COLUMN IF NOT EXISTS rival_gtd bigint CONSTRAINT sfs_rival_gtd_chk CHECK (rival_gtd IS NULL OR rival_gtd >= 0),
  ADD COLUMN IF NOT EXISTS capacity  integer CONSTRAINT sfs_capacity_chk  CHECK (capacity  IS NULL OR capacity  >= 0);

-- TP6 hit_capacity (post-event owner outcome) + TP9 is_shadow — on the owner-writable decision log.
ALTER TABLE public.series_decision_logs
  ADD COLUMN IF NOT EXISTS hit_capacity boolean,
  ADD COLUMN IF NOT EXISTS is_shadow    boolean NOT NULL DEFAULT false;

-- ===========================================================================================
-- ROLLBACK (undo this migration) — drop the columns (drops their inline CHECKs with them):
--   ALTER TABLE public.series_decision_logs      DROP COLUMN IF EXISTS is_shadow, DROP COLUMN IF EXISTS hit_capacity;
--   ALTER TABLE public.series_forecast_snapshots DROP COLUMN IF EXISTS capacity,
--                                                DROP COLUMN IF EXISTS rival_gtd,
--                                                DROP COLUMN IF EXISTS rival_major_event_same_day;
-- ===========================================================================================
