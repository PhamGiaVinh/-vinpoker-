create table public.web_vitals_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  metric_name text not null,
  metric_value double precision not null,
  rating text,
  metric_id text not null,
  delta double precision,
  navigation_type text,
  page text,
  user_agent text
);

create index idx_wv_created_at on public.web_vitals_events (created_at desc);
create index idx_wv_name_created on public.web_vitals_events (metric_name, created_at desc);

alter table public.web_vitals_events enable row level security;

create policy "Admins can read web vitals"
  on public.web_vitals_events for select to authenticated
  using (public.has_role(auth.uid(), 'super_admin'::public.app_role));