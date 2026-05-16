insert into storage.buckets (id, name, public)
values ('subtitles', 'subtitles', true)
on conflict (id) do nothing;

create policy "Subtitles public read"
on storage.objects for select
using (bucket_id = 'subtitles');

create policy "Super admin upload subtitles"
on storage.objects for insert
with check (bucket_id = 'subtitles' and has_role(auth.uid(), 'super_admin'::app_role));

create policy "Super admin update subtitles"
on storage.objects for update
using (bucket_id = 'subtitles' and has_role(auth.uid(), 'super_admin'::app_role));

create policy "Super admin delete subtitles"
on storage.objects for delete
using (bucket_id = 'subtitles' and has_role(auth.uid(), 'super_admin'::app_role));