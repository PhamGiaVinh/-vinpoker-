-- Floor Table Control V3 — additive shared table-inventory foundation.
--
-- This migration deliberately preserves every legacy `table_id` semantic.  V3
-- writers use the explicit IDs introduced below; old readers/writers remain
-- untouched until the later, owner-gated cutover/cleanup migration.
--
-- ROLLBACK (only before any V3 writer has been enabled):
--   DROP TABLE public.table_operation_receipts;
--   DROP TABLE public.table_sessions;
--   ALTER TABLE public.dealer_assignments DROP COLUMN table_session_id;
--   ALTER TABLE public.tournament_hands DROP COLUMN table_session_id,
--     DROP COLUMN tournament_table_id;
--   ALTER TABLE public.tournament_seats DROP COLUMN table_session_id,
--     DROP COLUMN tournament_table_id;
--   ALTER TABLE public.tournament_tables DROP COLUMN table_session_id,
--     DROP COLUMN game_table_id;
--   ALTER TABLE public.game_tables DROP COLUMN operational_status,
--     DROP COLUMN table_number;
-- Do not delete historical sessions, receipts, or audit rows after V3 use.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

-- A physical table remains a club-owned asset.  Existing records remain
-- unnumbered until an exact-ID, owner-gated backfill resolves them; NULL is
-- therefore intentionally permitted during the transition.  The same applies
-- to operational_status: V3 must not silently reinterpret an old
-- game_tables.status='maintenance' row as available.
ALTER TABLE public.game_tables
  ADD COLUMN IF NOT EXISTS table_number integer,
  ADD COLUMN IF NOT EXISTS operational_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.game_tables'::regclass
      AND conname = 'game_tables_table_number_range_check'
  ) THEN
    ALTER TABLE public.game_tables
      ADD CONSTRAINT game_tables_table_number_range_check
      CHECK (table_number IS NULL OR table_number BETWEEN 1 AND 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.game_tables'::regclass
      AND conname = 'game_tables_operational_status_check'
  ) THEN
    ALTER TABLE public.game_tables
      ADD CONSTRAINT game_tables_operational_status_check
      CHECK (
        operational_status IS NULL
        OR operational_status IN ('available', 'maintenance', 'disabled', 'retired')
      );
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_game_tables_club_table_number_v3
  ON public.game_tables (club_id, table_number)
  WHERE table_number IS NOT NULL;

-- These composite identities let future foreign keys prove that a session
-- belongs to the same club and physical table selected by a caller.  They are
-- additive: `id` remains the canonical primary key for every legacy reader.
CREATE UNIQUE INDEX IF NOT EXISTS uq_game_tables_id_club_v3
  ON public.game_tables (id, club_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tournaments_id_club_v3
  ON public.tournaments (id, club_id);

CREATE INDEX IF NOT EXISTS idx_game_tables_v3_inventory
  ON public.game_tables (club_id, operational_status, table_number)
  WHERE table_number IS NOT NULL;

-- A session is a lease of one physical table.  Closing it preserves history;
-- reopening the same physical table always creates a new identity and epoch.
CREATE TABLE IF NOT EXISTS public.table_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  game_table_id uuid NOT NULL REFERENCES public.game_tables(id) ON DELETE RESTRICT,
  session_type text NOT NULL CHECK (session_type IN ('tournament', 'cash', 'vip')),
  tournament_id uuid REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  control_mode text NOT NULL DEFAULT 'manual' CHECK (control_mode IN ('manual', 'tracker')),
  control_epoch bigint NOT NULL DEFAULT 1 CHECK (control_epoch >= 1),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  opened_by uuid,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid,
  closed_at timestamptz,
  close_reason text,
  audit_correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_sessions_game_table_club_v3_fkey
    FOREIGN KEY (game_table_id, club_id)
    REFERENCES public.game_tables(id, club_id) ON DELETE RESTRICT,
  CONSTRAINT table_sessions_tournament_club_v3_fkey
    FOREIGN KEY (tournament_id, club_id)
    REFERENCES public.tournaments(id, club_id) ON DELETE RESTRICT,
  CONSTRAINT table_sessions_tournament_context_check CHECK (
    (session_type = 'tournament' AND tournament_id IS NOT NULL)
    OR (session_type IN ('cash', 'vip') AND tournament_id IS NULL)
  ),
  CONSTRAINT table_sessions_close_actor_check CHECK (
    (closed_at IS NULL AND closed_by IS NULL)
    OR closed_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_table_sessions_one_active_game_table
  ON public.table_sessions (game_table_id)
  WHERE closed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_table_sessions_active_tournament_game_table
  ON public.table_sessions (tournament_id, game_table_id)
  WHERE closed_at IS NULL AND tournament_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_table_sessions_id_game_table_v3
  ON public.table_sessions (id, game_table_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_table_sessions_id_tournament_v3
  ON public.table_sessions (id, tournament_id);

CREATE INDEX IF NOT EXISTS idx_table_sessions_club_active
  ON public.table_sessions (club_id, opened_at DESC)
  WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_table_sessions_tournament_active
  ON public.table_sessions (tournament_id, opened_at DESC)
  WHERE closed_at IS NULL AND tournament_id IS NOT NULL;

ALTER TABLE public.table_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.table_sessions FROM PUBLIC, anon, authenticated;

-- Durable idempotency receipts are deliberately private from browser roles.
-- `request_fingerprint` makes an accidental re-use of a request ID fail closed.
CREATE TABLE IF NOT EXISTS public.table_operation_receipts (
  actor_id uuid NOT NULL,
  operation_type text NOT NULL,
  request_id uuid NOT NULL,
  request_fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, operation_type, request_id)
);

ALTER TABLE public.table_operation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.table_operation_receipts FROM PUBLIC, anon, authenticated;

-- Explicit V3 identity links.  They are nullable until exact-ID backfill is
-- qualified.  NOT VALID foreign keys protect all new writes without treating
-- mixed historical legacy IDs as a reason to rewrite or delete data here.
ALTER TABLE public.tournament_tables
  ADD COLUMN IF NOT EXISTS game_table_id uuid,
  ADD COLUMN IF NOT EXISTS table_session_id uuid;

ALTER TABLE public.tournament_seats
  ADD COLUMN IF NOT EXISTS tournament_table_id uuid,
  ADD COLUMN IF NOT EXISTS table_session_id uuid;

ALTER TABLE public.tournament_hands
  ADD COLUMN IF NOT EXISTS tournament_table_id uuid,
  ADD COLUMN IF NOT EXISTS table_session_id uuid;

ALTER TABLE public.dealer_assignments
  ADD COLUMN IF NOT EXISTS table_session_id uuid;

-- These referenced keys must exist before the composite foreign keys below.
-- PostgreSQL verifies the referenced uniqueness even for NOT VALID constraints.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_tables_id_tournament_v3
  ON public.tournament_tables (id, tournament_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_tables_id_session_v3
  ON public.tournament_tables (id, table_session_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_tables_game_table_id_v3_fkey') THEN
    ALTER TABLE public.tournament_tables
      ADD CONSTRAINT tournament_tables_game_table_id_v3_fkey
      FOREIGN KEY (game_table_id) REFERENCES public.game_tables(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_tables_table_session_id_v3_fkey') THEN
    ALTER TABLE public.tournament_tables
      ADD CONSTRAINT tournament_tables_table_session_id_v3_fkey
      FOREIGN KEY (table_session_id) REFERENCES public.table_sessions(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_tables_session_tournament_v3_fkey') THEN
    ALTER TABLE public.tournament_tables
      ADD CONSTRAINT tournament_tables_session_tournament_v3_fkey
      FOREIGN KEY (table_session_id, tournament_id)
      REFERENCES public.table_sessions(id, tournament_id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_tables_session_game_table_v3_fkey') THEN
    ALTER TABLE public.tournament_tables
      ADD CONSTRAINT tournament_tables_session_game_table_v3_fkey
      FOREIGN KEY (table_session_id, game_table_id)
      REFERENCES public.table_sessions(id, game_table_id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_seats_tournament_table_id_v3_fkey') THEN
    ALTER TABLE public.tournament_seats
      ADD CONSTRAINT tournament_seats_tournament_table_id_v3_fkey
      FOREIGN KEY (tournament_table_id) REFERENCES public.tournament_tables(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_seats_table_session_id_v3_fkey') THEN
    ALTER TABLE public.tournament_seats
      ADD CONSTRAINT tournament_seats_table_session_id_v3_fkey
      FOREIGN KEY (table_session_id) REFERENCES public.table_sessions(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_seats_table_tournament_v3_fkey') THEN
    ALTER TABLE public.tournament_seats
      ADD CONSTRAINT tournament_seats_table_tournament_v3_fkey
      FOREIGN KEY (tournament_table_id, tournament_id)
      REFERENCES public.tournament_tables(id, tournament_id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_seats_table_session_match_v3_fkey') THEN
    ALTER TABLE public.tournament_seats
      ADD CONSTRAINT tournament_seats_table_session_match_v3_fkey
      FOREIGN KEY (tournament_table_id, table_session_id)
      REFERENCES public.tournament_tables(id, table_session_id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_hands_tournament_table_id_v3_fkey') THEN
    ALTER TABLE public.tournament_hands
      ADD CONSTRAINT tournament_hands_tournament_table_id_v3_fkey
      FOREIGN KEY (tournament_table_id) REFERENCES public.tournament_tables(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_hands_table_session_id_v3_fkey') THEN
    ALTER TABLE public.tournament_hands
      ADD CONSTRAINT tournament_hands_table_session_id_v3_fkey
      FOREIGN KEY (table_session_id) REFERENCES public.table_sessions(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_hands_table_tournament_v3_fkey') THEN
    ALTER TABLE public.tournament_hands
      ADD CONSTRAINT tournament_hands_table_tournament_v3_fkey
      FOREIGN KEY (tournament_table_id, tournament_id)
      REFERENCES public.tournament_tables(id, tournament_id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournament_hands_table_session_match_v3_fkey') THEN
    ALTER TABLE public.tournament_hands
      ADD CONSTRAINT tournament_hands_table_session_match_v3_fkey
      FOREIGN KEY (tournament_table_id, table_session_id)
      REFERENCES public.tournament_tables(id, table_session_id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dealer_assignments_table_session_id_v3_fkey') THEN
    ALTER TABLE public.dealer_assignments
      ADD CONSTRAINT dealer_assignments_table_session_id_v3_fkey
      FOREIGN KEY (table_session_id) REFERENCES public.table_sessions(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dealer_assignments_session_game_table_v3_fkey') THEN
    ALTER TABLE public.dealer_assignments
      ADD CONSTRAINT dealer_assignments_session_game_table_v3_fkey
      FOREIGN KEY (table_session_id, table_id)
      REFERENCES public.table_sessions(id, game_table_id) ON DELETE RESTRICT NOT VALID;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_seats_active_entry_v3
  ON public.tournament_seats (tournament_id, entry_id)
  WHERE is_active = true AND entry_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_seats_active_explicit_seat_v3
  ON public.tournament_seats (tournament_table_id, seat_number)
  WHERE is_active = true AND tournament_table_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tournament_tables_v3_session
  ON public.tournament_tables (table_session_id)
  WHERE table_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tournament_seats_v3_session
  ON public.tournament_seats (table_session_id, seat_number)
  WHERE is_active = true AND table_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tournament_hands_v3_session
  ON public.tournament_hands (table_session_id)
  WHERE table_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dealer_assignments_v3_session_active
  ON public.dealer_assignments (table_session_id)
  WHERE table_session_id IS NOT NULL AND released_at IS NULL;

-- Metadata-only reconciliation report.  It never updates data and is intended
-- to drive exact-ID repair runbooks, never a broad delete or inferred mapping.
CREATE OR REPLACE FUNCTION public.get_floor_table_v3_preflight(p_club_id uuid)
RETURNS TABLE (
  finding_code text,
  entity_type text,
  entity_id uuid,
  details jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR p_club_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    EXISTS (
      SELECT 1
      FROM public.clubs c
      WHERE c.id = p_club_id
        AND c.owner_id = v_actor
    )
    OR public.is_club_floor(v_actor, p_club_id)
    OR public.is_club_dealer_control(v_actor, p_club_id)
    OR public.has_role(v_actor, 'super_admin'::public.app_role)
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    'UNNUMBERED_GAME_TABLE'::text,
    'game_table'::text,
    gt.id,
    jsonb_build_object('table_name', gt.table_name, 'status', gt.status)
  FROM public.game_tables gt
  WHERE gt.club_id = p_club_id
    AND gt.table_number IS NULL

  UNION ALL

  SELECT
    'LEGACY_OPERATIONAL_STATUS_UNMAPPED'::text,
    'game_table'::text,
    gt.id,
    jsonb_build_object('legacy_status', gt.status)
  FROM public.game_tables gt
  WHERE gt.club_id = p_club_id
    AND gt.operational_status IS NULL

  UNION ALL

  SELECT
    'LEGACY_TOURNAMENT_TABLE_UNMAPPED'::text,
    'tournament_table'::text,
    tt.id,
    jsonb_build_object('tournament_id', tt.tournament_id, 'legacy_table_id', tt.table_id)
  FROM public.tournament_tables tt
  JOIN public.tournaments t ON t.id = tt.tournament_id
  WHERE t.club_id = p_club_id
    AND tt.status = 'active'
    AND (tt.game_table_id IS NULL OR tt.table_session_id IS NULL)

  UNION ALL

  SELECT
    'ACTIVE_SEAT_EXPLICIT_LINK_MISSING'::text,
    'tournament_seat'::text,
    ts.id,
    jsonb_build_object('tournament_id', ts.tournament_id, 'legacy_table_id', ts.table_id, 'entry_id', ts.entry_id)
  FROM public.tournament_seats ts
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE t.club_id = p_club_id
    AND ts.is_active = true
    AND (ts.tournament_table_id IS NULL OR ts.table_session_id IS NULL)

  UNION ALL

  SELECT
    'ACTIVE_SESSION_CLUB_MISMATCH'::text,
    'table_session'::text,
    s.id,
    jsonb_build_object('session_club_id', s.club_id, 'game_table_club_id', gt.club_id)
  FROM public.table_sessions s
  JOIN public.game_tables gt ON gt.id = s.game_table_id
  WHERE s.club_id = p_club_id
    AND s.closed_at IS NULL
    AND s.club_id IS DISTINCT FROM gt.club_id

  UNION ALL

  SELECT
    'LEGACY_TOURNAMENT_TABLE_UNIQUE_TABLE_ID_PREREQUISITE'::text,
    'schema_constraint'::text,
    NULL::uuid,
    jsonb_build_object(
      'constraint_name', con.conname,
      'definition', pg_catalog.pg_get_constraintdef(con.oid, true),
      'required_before_v3_assignment_reuse', true
    )
  FROM pg_catalog.pg_constraint con
  WHERE con.conrelid = 'public.tournament_tables'::regclass
    AND con.contype = 'u'
    AND pg_catalog.pg_get_constraintdef(con.oid, true) LIKE 'UNIQUE (table_id)%';
END;
$$;

ALTER FUNCTION public.get_floor_table_v3_preflight(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_floor_table_v3_preflight(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_floor_table_v3_preflight(uuid) TO authenticated;

COMMENT ON TABLE public.table_sessions IS
  'Floor Table Control V3: immutable-use identity for a physical club table. Closing preserves history.';
COMMENT ON COLUMN public.tournament_entries.table_id IS
  'Legacy placement cache only during Floor Table Control V3 transition. Active tournament_seats is authoritative.';

COMMIT;
