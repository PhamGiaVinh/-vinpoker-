-- Run only against a disposable/local database after migrations.
-- This contract test is read-only; behavioral concurrency tests still require the
-- seeded TEST tournament suite and are intentionally not run against production.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='hand_players' AND column_name='player_name'
  ) THEN RAISE EXCEPTION 'missing hand_players.player_name'; END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tournament_eliminations' AND column_name='hand_id' AND is_nullable<>'YES'
  ) THEN RAISE EXCEPTION 'tournament_eliminations.hand_id must be nullable'; END IF;

  IF NOT has_function_privilege('anon','public.get_public_tournament_clock_summary(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'anon clock read missing';
  END IF;
  IF NOT has_function_privilege('anon','public.get_public_tournament_results(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'anon results read missing';
  END IF;
  IF has_function_privilege('anon','public.bust_tournament_player_with_payout(uuid,uuid,integer,text)','EXECUTE') THEN
    RAISE EXCEPTION 'anon must not bust players';
  END IF;
  IF has_function_privilege('authenticated','public.commit_tournament_live_resettle(uuid,uuid,uuid,text,text,timestamptz,integer,jsonb,jsonb,jsonb,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must not execute private resettle commit';
  END IF;
  IF NOT has_function_privilege('service_role','public.commit_tournament_live_resettle(uuid,uuid,uuid,text,text,timestamptz,integer,jsonb,jsonb,jsonb,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'service role resettle commit grant missing';
  END IF;
END;
$$;
