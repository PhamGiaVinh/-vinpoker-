-- Two independent flights for competing direct hand writes vs End Flight.
INSERT INTO public.tournaments VALUES
 ('40000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001','flight',NULL),
 ('40000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001','flight',NULL);
INSERT INTO public.tournament_entries
SELECT ('50000000-0000-0000-0000-00000000000'||n)::uuid,
       ('40000000-0000-0000-0000-00000000000'||n)::uuid,
       ('60000000-0000-0000-0000-00000000000'||n)::uuid,1
FROM generate_series(4,5) n;
INSERT INTO public.table_sessions
SELECT ('70000000-0000-0000-0000-00000000000'||n)::uuid,
       ('40000000-0000-0000-0000-00000000000'||n)::uuid,2
FROM generate_series(4,5) n;
INSERT INTO public.tournament_tables
SELECT ('80000000-0000-0000-0000-00000000000'||n)::uuid,
       ('40000000-0000-0000-0000-00000000000'||n)::uuid,
       ('70000000-0000-0000-0000-00000000000'||n)::uuid
FROM generate_series(4,5) n;
INSERT INTO public.dealer_assignments
SELECT ('90000000-0000-0000-0000-00000000000'||n)::uuid,
       ('70000000-0000-0000-0000-00000000000'||n)::uuid,'assigned',NULL,0
FROM generate_series(4,5) n;
INSERT INTO public.tournament_seats
SELECT ('a0000000-0000-0000-0000-00000000000'||n)::uuid,
       ('40000000-0000-0000-0000-00000000000'||n)::uuid,
       ('60000000-0000-0000-0000-00000000000'||n)::uuid,
       ('50000000-0000-0000-0000-00000000000'||n)::uuid,1,
       ('80000000-0000-0000-0000-00000000000'||n)::uuid,
       ('70000000-0000-0000-0000-00000000000'||n)::uuid,1,true
FROM generate_series(4,5) n;
INSERT INTO public.tournament_chip_counts
SELECT ('b0000000-0000-0000-0000-00000000000'||n)::uuid,
       ('40000000-0000-0000-0000-00000000000'||n)::uuid,
       ('60000000-0000-0000-0000-00000000000'||n)::uuid,1,90000,now()
FROM generate_series(4,5) n;
