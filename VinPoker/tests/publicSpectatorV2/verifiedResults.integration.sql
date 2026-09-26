-- Executes the real public history RPC against disposable PostgreSQL 17.
-- No result in this file is a frontend mock and no production row is touched.
SELECT set_config('request.jwt.claim.role', 'service_role', false);

INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no) VALUES
  ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003',1);

INSERT INTO public.tournament_hands(
  id,tournament_id,tournament_table_id,table_session_id,hand_number,button_seat,
  community_cards,pot_size,tracker_small_blind,tracker_big_blind,tracker_bba,
  status,source_revision,created_at
) VALUES
  ('61000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',31,1,'["AS","KH","7C"]',200000,50000,100000,100000,'completed',1,'2026-09-24T08:01:00Z'),
  ('61000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',32,2,'["2S","3H","4C","5D","9S"]',280000,10000,20000,0,'completed',1,'2026-09-24T08:02:00Z'),
  ('61000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',33,3,'[]',100000,50000,100000,0,'completed',1,'2026-09-24T08:03:00Z'),
  ('61000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',34,1,'["QC","JD","8S"]',200000,50000,100000,0,'completed',2,'2026-09-24T08:04:00Z'),
  ('61000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',35,2,'["AC","AD","6S"]',200000,NULL,NULL,NULL,'completed',1,'2026-09-24T08:05:00Z'),
  ('61000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',36,3,'[]',NULL,50000,100000,0,'completed',1,'2026-09-24T08:06:00Z');

INSERT INTO public.hand_players(
  id,hand_id,tournament_id,player_id,entry_number,seat_number,player_name,
  starting_stack,ending_stack,hole_cards
)
SELECT gen_random_uuid(), h.id, h.tournament_id, p.player_id, 1, p.seat_number,
       p.player_name, 1000000, 1000000 + p.net_delta, p.hole_cards
FROM public.tournament_hands h
CROSS JOIN (VALUES
  ('50000000-0000-4000-8000-000000000001'::uuid,1,'A', 160000::numeric,'["AS","KD"]'::jsonb),
  ('50000000-0000-4000-8000-000000000002'::uuid,2,'B', -60000::numeric,'[]'::jsonb),
  ('50000000-0000-4000-8000-000000000003'::uuid,3,'C', -100000::numeric,'[]'::jsonb)
) AS p(player_id,seat_number,player_name,net_delta,hole_cards)
WHERE h.id::text LIKE '61000000-%';

INSERT INTO public.tournament_settlement_outcomes(
  tournament_id,hand_id,source_revision,settlement_revision,status,public_outcome
) VALUES
  ('10000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',1,1,'verified',
    '{"players":[{"playerId":"50000000-0000-4000-8000-000000000001","potAward":200000,"refund":0,"netDelta":100000},{"playerId":"50000000-0000-4000-8000-000000000002","potAward":0,"refund":0,"netDelta":-100000}],"pots":[{"kind":"main","allocations":[{"winnerId":"50000000-0000-4000-8000-000000000001","amount":200000}]}],"refunds":[]}'::jsonb),
  ('10000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002',1,1,'verified',
    '{"players":[{"playerId":"50000000-0000-4000-8000-000000000001","potAward":240000,"refund":0,"netDelta":160000},{"playerId":"50000000-0000-4000-8000-000000000002","potAward":40000,"refund":0,"netDelta":-60000},{"playerId":"50000000-0000-4000-8000-000000000003","potAward":0,"refund":0,"netDelta":-100000}],"pots":[{"kind":"main","allocations":[{"winnerId":"50000000-0000-4000-8000-000000000001","amount":240000}]},{"kind":"side","allocations":[{"winnerId":"50000000-0000-4000-8000-000000000002","amount":40000}]}],"refunds":[]}'::jsonb),
  ('10000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003',1,1,'verified',
    '{"players":[{"playerId":"50000000-0000-4000-8000-000000000001","potAward":100000,"refund":0,"netDelta":50000},{"playerId":"50000000-0000-4000-8000-000000000003","potAward":0,"refund":50000,"netDelta":0}],"pots":[{"kind":"main","allocations":[{"winnerId":"50000000-0000-4000-8000-000000000001","amount":100000}]}],"refunds":[{"playerId":"50000000-0000-4000-8000-000000000003","amount":50000}]}'::jsonb),
  -- Stale proof: source revision 1 cannot verify hand revision 2.
  ('10000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000004',1,1,'verified',
    '{"players":[{"playerId":"50000000-0000-4000-8000-000000000001","potAward":200000,"refund":0,"netDelta":100000}],"pots":[{"kind":"main","allocations":[{"winnerId":"50000000-0000-4000-8000-000000000001","amount":200000}]}],"refunds":[]}'::jsonb),
  ('10000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005',1,1,'verified',
    '{"players":[{"playerId":"50000000-0000-4000-8000-000000000001","potAward":200000,"refund":0,"netDelta":100000}],"pots":[{"kind":"main","allocations":[{"winnerId":"50000000-0000-4000-8000-000000000001","amount":200000}]}],"refunds":[]}'::jsonb);

SET ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', false);
DO $$
DECLARE
  v_page jsonb;
  v_other_table jsonb;
BEGIN
  v_page := public.get_public_tournament_table_history_v2(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001', 50, NULL, NULL
  );

  IF v_page->>'access' IS DISTINCT FROM 'public' THEN
    RAISE EXCEPTION 'anon could not call real history RPC: %', v_page;
  END IF;
  IF jsonb_path_query_first(v_page, '$.items[*] ? (@.handId == "61000000-0000-4000-8000-000000000001").result.status') #>> '{}' IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'fold win was not verified: %', v_page;
  END IF;
  IF jsonb_path_query_first(v_page, '$.items[*] ? (@.handId == "61000000-0000-4000-8000-000000000002").result.recipients[*] ? (@.playerId == "50000000-0000-4000-8000-000000000002").netDelta') #>> '{}' IS DISTINCT FROM '-60000' THEN
    RAISE EXCEPTION 'negative-net side-pot recipient was lost: %', v_page;
  END IF;
  IF jsonb_array_length(jsonb_path_query_array(v_page, '$.items[*] ? (@.handId == "61000000-0000-4000-8000-000000000002").result.recipients[*]')) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'split recipients were not deduplicated by participant: %', v_page;
  END IF;
  IF jsonb_path_exists(v_page, '$.items[*] ? (@.handId == "61000000-0000-4000-8000-000000000003").result.recipients[*] ? (@.playerId == "50000000-0000-4000-8000-000000000003")') THEN
    RAISE EXCEPTION 'refund-only player became a pot recipient: %', v_page;
  END IF;
  IF jsonb_path_query_first(v_page, '$.items[*] ? (@.handId == "61000000-0000-4000-8000-000000000004").result.status') #>> '{}' IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'stale source revision was accepted: %', v_page;
  END IF;
  IF jsonb_path_query_first(v_page, '$.items[*] ? (@.handId == "61000000-0000-4000-8000-000000000005").bigBlind') #>> '{}' IS NOT NULL THEN
    RAISE EXCEPTION 'missing BB was invented: %', v_page;
  END IF;
  IF jsonb_path_query_first(v_page, '$.items[*] ? (@.handId == "61000000-0000-4000-8000-000000000006").result.status') #>> '{}' IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'hand without settlement was not pending: %', v_page;
  END IF;
  -- Only explicitly recorded cards are public; no absent card is synthesized.
  IF jsonb_path_query_first(v_page, '$.items[*] ? (@.handId == "61000000-0000-4000-8000-000000000001").result.recipients[0].holeCards[0]') #>> '{}' IS DISTINCT FROM 'AS' THEN
    RAISE EXCEPTION 'recorded public cards missing: %', v_page;
  END IF;

  v_other_table := public.get_public_tournament_table_history_v2(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002', 50, NULL, NULL
  );
  IF jsonb_path_exists(v_other_table, '$.items[*] ? (@.handId like_regex "^61000000")') THEN
    RAISE EXCEPTION 'table scope leaked another physical table: %', v_other_table;
  END IF;
END;
$$;
RESET ROLE;
