create table if not exists public.gto_app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.gto_app_settings enable row level security;

create policy "gto_app_settings public read"
  on public.gto_app_settings for select
  using (true);

create policy "gto_app_settings admin write"
  on public.gto_app_settings for all
  to authenticated
  using (public.has_role(auth.uid(), 'super_admin'))
  with check (public.has_role(auth.uid(), 'super_admin'));

alter publication supabase_realtime add table public.gto_app_settings;

insert into public.gto_app_settings (key, value)
values ('visible_stack_depths', '[50]'::jsonb)
on conflict (key) do nothing;