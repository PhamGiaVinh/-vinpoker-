-- ============================================================================
-- 20260817000000_online_poker_core.sql
-- Online Poker (play-money) base schema - GE-2 Patch A.
-- ADDITIVE + IDEMPOTENT (safe to run twice). Touches ONLY public.online_poker_*.
-- SOURCE-ONLY: this file is authored, NOT applied here. No RPC / Edge / realtime
-- in this migration (realtime is a separate, guarded migration).
--
-- CHIP / MONEY MODEL ---------------------------------------------------------
--   All chip/stack/pot/balance amounts are PLAY CHIPS, stored as `bigint`.
--   This is NOT real money. The application boundary (engine GE-1 uses JS bigint)
--   must serialize chips as DECIMAL STRINGS over JSON/transport - never as a JS
--   number (precision loss past 2^53). Non-negative / range CHECK constraints are
--   DB backstops so the schema itself never permits a negative stack/pot/balance,
--   an out-of-range seat, or two active hands per table - independent of the RPCs.
--
-- SECRECY MODEL --------------------------------------------------------------
--   PUBLIC rail tables (tables/seats/hands/hand_seats/hand_events/hand_snapshots)
--   carry PUBLIC state only and are SELECT-able by any authenticated user.
--   PRIVATE data (full deck, hole cards, server_seed, undealt board) lives ONLY
--   in online_poker_hand_secrets, which is deny-all (FORCE RLS, no policy) and is
--   never published to realtime. Writes happen only via SECURITY DEFINER RPCs /
--   service_role added in a later patch - Patch A defines NO write policies.
-- ============================================================================

-- 1) online_poker_tables - a poker room/table -------------------------------
CREATE TABLE IF NOT EXISTS public.online_poker_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid REFERENCES public.clubs(id),               -- NULL = global lobby (MVP)
  name text NOT NULL,
  max_seats int NOT NULL DEFAULT 9 CHECK (max_seats BETWEEN 2 AND 10),
  sb bigint NOT NULL CHECK (sb > 0),
  bb bigint NOT NULL,
  min_buyin bigint NOT NULL CHECK (min_buyin >= 0),
  max_buyin bigint NOT NULL,
  starting_stack_default bigint NOT NULL CHECK (starting_stack_default >= 0),
  act_timeout_secs int NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paused','closed')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (bb > sb),                                         -- big blind strictly above small blind
  CHECK (max_buyin >= min_buyin)
);

-- 2) online_poker_player_accounts - play-chip wallet ------------------------
CREATE TABLE IF NOT EXISTS public.online_poker_player_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0), -- server-ledger derived; never negative
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3) online_poker_seats - persistent seat occupancy --------------------------
CREATE TABLE IF NOT EXISTS public.online_poker_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES public.online_poker_tables(id) ON DELETE CASCADE,
  seat_no int NOT NULL CHECK (seat_no BETWEEN 1 AND 10),
  user_id uuid REFERENCES auth.users(id),
  stack bigint NOT NULL DEFAULT 0 CHECK (stack >= 0),
  status text NOT NULL DEFAULT 'empty' CHECK (status IN ('empty','sitting','sitting_out')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_id, seat_no)
);
-- DB backstop: a user may occupy at most ONE seat per table while seated.
CREATE UNIQUE INDEX IF NOT EXISTS idx_op_one_user_per_table
  ON public.online_poker_seats (table_id, user_id)
  WHERE user_id IS NOT NULL AND status IN ('sitting','sitting_out');

-- 4) online_poker_hands - PUBLIC authoritative hand state -------------------
CREATE TABLE IF NOT EXISTS public.online_poker_hands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid NOT NULL REFERENCES public.online_poker_tables(id) ON DELETE CASCADE,
  hand_no bigint NOT NULL,
  state_version int NOT NULL DEFAULT 0,                    -- optimistic-CAS guard (Phase-1 Edge)
  state_schema_version int NOT NULL DEFAULT 1,             -- shape of the state JSON
  engine_version text,                                    -- engine build that produced the hand
  button_seat int,
  street text NOT NULL DEFAULT 'preflop'
    CHECK (street IN ('preflop','flop','turn','river','showdown','complete')),
  board jsonb NOT NULL DEFAULT '[]'::jsonb,                -- revealed community cards only
  pot bigint NOT NULL DEFAULT 0 CHECK (pot >= 0),
  side_pots jsonb NOT NULL DEFAULT '[]'::jsonb,
  to_act_seat int,
  act_deadline timestamptz,                               -- auto-fold (hybrid timeout)
  status text NOT NULL DEFAULT 'dealing'
    CHECK (status IN ('dealing','betting','complete','voided')),
  state jsonb NOT NULL DEFAULT '{}'::jsonb,                -- PUBLIC HandState projection (no hidden cards)
  shuffle_commit text,                                    -- provable-fair: published BEFORE the hand
  shuffle_reveal text,                                    -- provable-fair: revealed AT completion
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_id, hand_no)
);
CREATE INDEX IF NOT EXISTS idx_op_hands_active
  ON public.online_poker_hands (table_id, status)
  WHERE status IN ('dealing','betting');
CREATE INDEX IF NOT EXISTS idx_op_hands_deadline
  ON public.online_poker_hands (act_deadline)
  WHERE status = 'betting';
-- DB backstop: at most ONE active (dealing/betting) hand per table.
CREATE UNIQUE INDEX IF NOT EXISTS idx_op_one_active_hand_per_table
  ON public.online_poker_hands (table_id)
  WHERE status IN ('dealing','betting');

-- 5) online_poker_hand_seats - per-hand per-seat PUBLIC facts ----------------
CREATE TABLE IF NOT EXISTS public.online_poker_hand_seats (
  hand_id uuid NOT NULL REFERENCES public.online_poker_hands(id) ON DELETE CASCADE,
  seat_no int NOT NULL CHECK (seat_no BETWEEN 1 AND 10),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  starting_stack bigint NOT NULL CHECK (starting_stack >= 0),
  stack bigint NOT NULL CHECK (stack >= 0),
  committed bigint NOT NULL DEFAULT 0 CHECK (committed >= 0),  -- this street (metadata)
  total_committed bigint NOT NULL DEFAULT 0,                   -- all streets (side-pot math)
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','folded','allin')),
  revealed_cards jsonb,                                    -- PUBLIC; NULL until a legitimate showdown reveal
  PRIMARY KEY (hand_id, seat_no),
  CHECK (total_committed >= committed)                     -- all-streets total includes the current street
);

-- 6) online_poker_hand_events - authoritative append-only PUBLIC log ---------
CREATE TABLE IF NOT EXISTS public.online_poker_hand_events (
  hand_id uuid NOT NULL REFERENCES public.online_poker_hands(id) ON DELETE CASCADE,
  event_seq int NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,              -- PUBLIC-ONLY (see table comment)
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hand_id, event_seq)
);

-- 7) online_poker_actions - append-only request log + durable idempotency ----
CREATE TABLE IF NOT EXISTS public.online_poker_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hand_id uuid NOT NULL REFERENCES public.online_poker_hands(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  idempotency_key text NOT NULL UNIQUE,                   -- crash-safe dedupe; client UUID/ULID
  action jsonb NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 8) online_poker_hand_secrets - SERVER-ONLY deck + hole cards (deny-all) -----
--    PK is a plain uuid because a Postgres PRIMARY KEY cannot use an expression;
--    uniqueness on (hand_id, kind, COALESCE(seat_no,-1)) is a UNIQUE INDEX below.
CREATE TABLE IF NOT EXISTS public.online_poker_hand_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hand_id uuid NOT NULL REFERENCES public.online_poker_hands(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('deck','hole','board_future')),
  seat_no int,                                            -- for kind = 'hole'
  cards jsonb,
  server_seed text,                                       -- provable-fair (revealed after the hand)
  server_seed_commit text,                                -- sha256(server_seed), published before the hand
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (seat_no IS NULL OR seat_no BETWEEN 1 AND 10),
  -- hole cards are per-seat; deck/board_future are table-wide (no seat)
  CHECK ((kind = 'hole' AND seat_no IS NOT NULL)
      OR (kind IN ('deck','board_future') AND seat_no IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS online_poker_hand_secrets_unique_key
  ON public.online_poker_hand_secrets (hand_id, kind, COALESCE(seat_no, -1));

-- 9) online_poker_hand_snapshots - O(1) recovery (PUBLIC projection) ----------
CREATE TABLE IF NOT EXISTS public.online_poker_hand_snapshots (
  hand_id uuid NOT NULL REFERENCES public.online_poker_hands(id) ON DELETE CASCADE,
  at_seq int NOT NULL,                                    -- snapshot taken AFTER this event_seq
  state jsonb NOT NULL,                                   -- PUBLIC HandState projection only
  schema_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hand_id, at_seq)
);

-- 10) online_poker_chip_ledger - append-only play-chip audit -----------------
CREATE TABLE IF NOT EXISTS public.online_poker_chip_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  table_id uuid REFERENCES public.online_poker_tables(id),
  hand_id uuid REFERENCES public.online_poker_hands(id),
  type text NOT NULL CHECK (type IN ('grant','buyin','rebuy','cashout')),
  -- amount is a SIGNED wallet delta: grant/cashout add to the wallet (+),
  -- buyin/rebuy move chips out to the table (-). Never zero.
  amount bigint NOT NULL CHECK (amount <> 0),
  balance_after bigint NOT NULL CHECK (balance_after >= 0), -- resulting wallet balance; never negative
  idempotency_key text NOT NULL UNIQUE,                  -- crash-safe dedupe; UUID/ULID (NOT NULL: a nullable UNIQUE allows many NULLs => no dedupe)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_op_chip_ledger_user
  ON public.online_poker_chip_ledger (user_id, created_at DESC);

-- ============================================================================
-- Row Level Security
--   Public rail: SELECT for any authenticated user (public state only).
--   Own-row: actions / chip_ledger / player_accounts - only the owning user.
--   Secrets: deny-all (FORCE RLS, no policy).
--   NO INSERT/UPDATE/DELETE policies in Patch A - all writes go through
--   SECURITY DEFINER RPCs / service_role added in a later patch.
-- ============================================================================

-- public rail tables
ALTER TABLE public.online_poker_tables        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_poker_seats         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_poker_hands         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_poker_hand_seats    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_poker_hand_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_poker_hand_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS op_tables_select        ON public.online_poker_tables;
CREATE POLICY op_tables_select        ON public.online_poker_tables        FOR SELECT USING (true);
DROP POLICY IF EXISTS op_seats_select         ON public.online_poker_seats;
CREATE POLICY op_seats_select         ON public.online_poker_seats         FOR SELECT USING (true);
DROP POLICY IF EXISTS op_hands_select         ON public.online_poker_hands;
CREATE POLICY op_hands_select         ON public.online_poker_hands         FOR SELECT USING (true);
DROP POLICY IF EXISTS op_hand_seats_select    ON public.online_poker_hand_seats;
CREATE POLICY op_hand_seats_select    ON public.online_poker_hand_seats    FOR SELECT USING (true);
DROP POLICY IF EXISTS op_hand_events_select   ON public.online_poker_hand_events;
CREATE POLICY op_hand_events_select   ON public.online_poker_hand_events   FOR SELECT USING (true);
DROP POLICY IF EXISTS op_hand_snapshots_select ON public.online_poker_hand_snapshots;
CREATE POLICY op_hand_snapshots_select ON public.online_poker_hand_snapshots FOR SELECT USING (true);

-- own-row tables
ALTER TABLE public.online_poker_actions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_poker_chip_ledger     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_poker_player_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS op_actions_select_own    ON public.online_poker_actions;
CREATE POLICY op_actions_select_own    ON public.online_poker_actions
  FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS op_chip_ledger_select_own ON public.online_poker_chip_ledger;
CREATE POLICY op_chip_ledger_select_own ON public.online_poker_chip_ledger
  FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS op_player_accounts_select_own ON public.online_poker_player_accounts;
CREATE POLICY op_player_accounts_select_own ON public.online_poker_player_accounts
  FOR SELECT USING (user_id = auth.uid());

-- secrets: deny-all. ENABLE + FORCE RLS and NO policy => no role (incl. table owner)
-- can read except a SECURITY DEFINER function or service_role (which bypass RLS).
ALTER TABLE public.online_poker_hand_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_poker_hand_secrets FORCE  ROW LEVEL SECURITY;

-- ============================================================================
-- Documentation of the secrecy / chip boundaries (audit-friendly)
-- ============================================================================
COMMENT ON TABLE  public.online_poker_hand_secrets IS
  'SERVER-ONLY private store: full deck, per-seat hole cards, undealt board, provable-fair server_seed. Deny-all RLS (FORCE, no policy); never published to realtime; readable only via SECURITY DEFINER RPC / service_role.';
COMMENT ON TABLE  public.online_poker_hand_events IS
  'Authoritative append-only PUBLIC event log. payload is PUBLIC-ONLY: it must NEVER contain hole cards, deck order, server_seed, or unrevealed board cards - those live only in online_poker_hand_secrets.';
COMMENT ON COLUMN public.online_poker_hands.state IS
  'PUBLIC HandState projection only - must never contain hole cards or undealt board.';
COMMENT ON COLUMN public.online_poker_hands.engine_version IS
  'Engine build that produced this hand - pins deterministic replay across engine upgrades.';
COMMENT ON COLUMN public.online_poker_hand_seats.revealed_cards IS
  'PUBLIC; remains NULL until a legitimate showdown reveal of a contesting seat (mucked/folded stay NULL).';
COMMENT ON COLUMN public.online_poker_actions.idempotency_key IS
  'Durable crash-safe dedupe key (global UNIQUE). Must be a strong UUID/ULID-style value so distinct actions never collide.';
COMMENT ON COLUMN public.online_poker_player_accounts.balance IS
  'Play chips (bigint; NOT real money). Server-ledger derived - clients never update directly; mutated only via SECURITY DEFINER RPC / service_role. Serialize as a decimal string over transport.';
COMMENT ON COLUMN public.online_poker_chip_ledger.amount IS
  'Play chips (bigint; NOT real money). SIGNED wallet delta: grant/cashout add (+), buyin/rebuy remove (-); never zero. balance_after = resulting non-negative wallet balance. Append-only audit. Serialize as a decimal string over transport.';
