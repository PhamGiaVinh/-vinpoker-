-- Series Intelligence — CAPTURE v0 SEED (test data). SOURCE-ONLY, NOT a migration.
--
-- The leading underscore keeps this file OUT of the migration sequence (same convention as
-- _dry_run_june_2026.sql / _payout_engine_*.sql) — the runner will NOT auto-apply it.
--
-- PURPOSE: after the owner applies 20261125000000_series_capture_v0.sql, run THIS once (Supabase SQL
-- editor or `supabase db query --linked --file`) to drop a handful of demo rows into all 4 tables, so
-- when the seriesDecisionLog flag is flipped on the admin panel + downstream readers show real data,
-- not an empty screen. It is owner-scoped demo data — delete it before going live.
--
-- HOW: replace the two placeholders below with disposable ids YOU own:
--   <club_id>   = a club you own (clubs.id, clubs.owner_id = you)
--   <event_id>  = a tournament in THAT club (tournaments.id, tournaments.club_id = <club_id>)
-- The RLS WITH CHECK requires the event to belong to the same club; run as service role (SQL editor)
-- which bypasses RLS, or as the owner. created_by is left NULL when seeded (no auth context).
--
-- player_ref_hash here uses md5(...) ONLY to demonstrate an opaque/hashed value — NEVER store a raw
-- phone/name/handle. md5 is a built-in (no pgcrypto needed); real capture should use a strong hash.

DO $$
DECLARE
  v_club  uuid := '<club_id>'::uuid;   -- ← replace
  v_event uuid := '<event_id>'::uuid;  -- ← replace
  v_snap  uuid;
BEGIN
  -- 1) a pre-event forecast snapshot (the record a forecast layer would write later)
  INSERT INTO public.series_forecast_snapshots
    (club_id, event_id, horizon, days_before, forecast_base, forecast_low, forecast_high,
     confidence_tier, candidate_gtd, overlay_risk_pct, source_label, notes)
  VALUES
    (v_club, v_event, 'T-7', 7, 180, 140, 230, 'medium', 5000000000, 18.5, 'turnout-forecast', 'seed demo')
  RETURNING id INTO v_snap;

  -- 2) the decision the owner took at T-7, linked to the snapshot they saw
  INSERT INTO public.series_decision_logs
    (club_id, event_id, forecast_snapshot_id, decision_horizon,
     recommended_action, owner_decision, public_action, decision_reason)
  VALUES
    (v_club, v_event, v_snap, 'T-7',
     'Giữ GTD 5 tỷ', 'Giữ', 'Công bố lịch + đẩy marketing', 'Forecast P50 ~180, đủ phủ GTD');

  -- 3) the post-event outcome (scoring-only actuals) for the same event
  INSERT INTO public.series_decision_logs
    (club_id, event_id, forecast_snapshot_id, decision_horizon, actual_result,
     actual_entries, actual_unique_players, actual_reentries, actual_prize_pool, actual_overlay_amount,
     post_event_reason)
  VALUES
    (v_club, v_event, v_snap, 'post', 'Đủ GTD, không overlay',
     205, 160, 45, 4100000000, 0, 'Field mạnh hơn dự báo nhờ satellite');

  -- 4) a marketing campaign tied to the event
  INSERT INTO public.series_campaign_logs
    (club_id, campaign_id, event_linked, channel, spend, creative_type, target_segment,
     baseline_expected_entries, decision_reason)
  VALUES
    (v_club, 'CMP-001', v_event, 'facebook', 3000000, 'video', 'regular+lapsed', 150, 'Đẩy field cho Main');

  -- 5) a few registration events (funnel + a re-entry; hashed player refs, NO PII)
  INSERT INTO public.series_registration_events
    (club_id, event_id, player_ref_hash, player_ref_type, registered_at, is_reentry, bullet, commitment_stage, entry_source)
  VALUES
    (v_club, v_event, md5('seed-player-1'), 'phone',       now() - interval '5 days', false, 1, 'paid',     'direct'),
    (v_club, v_event, md5('seed-player-1'), 'phone',       now() - interval '1 day',  true,  2, 'paid',     'floor'),
    (v_club, v_event, md5('seed-player-2'), 'app_user_id', now() - interval '3 days', false, 1, 'reserved', 'online'),
    (v_club, v_event, md5('seed-player-3'), 'host_label',  now() - interval '2 days', false, 1, 'interested','direct');

  RAISE NOTICE 'CAPTURE v0 seed inserted for club % / event %', v_club, v_event;
END $$;

-- CLEANUP (remove the seed rows before going live):
--   DELETE FROM public.series_registration_events WHERE club_id = '<club_id>'::uuid;
--   DELETE FROM public.series_campaign_logs        WHERE club_id = '<club_id>'::uuid AND campaign_id = 'CMP-001';
--   DELETE FROM public.series_decision_logs        WHERE club_id = '<club_id>'::uuid;
--   DELETE FROM public.series_forecast_snapshots   WHERE club_id = '<club_id>'::uuid AND source_label = 'turnout-forecast';
