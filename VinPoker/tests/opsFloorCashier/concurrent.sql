-- Each workflow process runs this file in a separate psql session.
\set ON_ERROR_STOP on
SET ROLE authenticated;
SET test.actor = '00000000-0000-0000-0000-000000000002';
SELECT public.ops_create_offline_buyin_and_seat(
  (SELECT id FROM public.tournaments WHERE name = 'Atomic test'),
  'Concurrent Player',
  'atomic-concurrent',
  NULL,
  'random_balanced'
);
