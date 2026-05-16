create table if not exists public.gto_user_spot_ranges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  spot_key text not null,
  range jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, spot_key)
);

alter table public.gto_user_spot_ranges enable row level security;

create policy "users read own gto ranges"
  on public.gto_user_spot_ranges for select
  to authenticated
  using (auth.uid() = user_id);

create policy "users insert own gto ranges"
  on public.gto_user_spot_ranges for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "users update own gto ranges"
  on public.gto_user_spot_ranges for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users delete own gto ranges"
  on public.gto_user_spot_ranges for delete
  to authenticated
  using (auth.uid() = user_id);

create index if not exists gto_user_spot_ranges_user_idx on public.gto_user_spot_ranges(user_id);

alter publication supabase_realtime add table public.gto_user_spot_ranges;