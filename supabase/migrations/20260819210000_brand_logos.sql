-- Custom brand logos, for the brands the catalogue has never heard of.
--
-- `brands.logo_url` has existed since 20260808230000_brand_identity.sql but
-- nothing on the site could fill it: the column was only reachable through the
-- portfolio import. The add is repeated idempotently so this file reads as the
-- whole feature on its own.

alter table public.brands
  add column if not exists logo_url text;

-- -------------------------------------------------------------------- storage

-- Same bargain the `portfolio` bucket makes: public, because the mark renders
-- in <img> tags all over the dashboard and a signed url that expires would
-- break every one of them. 1MB is plenty - raster logos are resized to a 400px
-- webp in the browser before they get here (lib/brand-logo-upload.ts) and svgs
-- are small by nature.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-logos',
  'brand-logos',
  true,
  1048576,
  array['image/webp', 'image/png', 'image/jpeg', 'image/svg+xml']
)
on conflict (id) do nothing;

-- Writes are scoped by the first path segment being the caller's uid, which is
-- why every upload path in lib/brand-logo-upload.ts starts with `${userId}/`.
-- Nothing enforces that on the client, so it is enforced here.
drop policy if exists brand_logo_objects_insert on storage.objects;
create policy brand_logo_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'brand-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists brand_logo_objects_update on storage.objects;
create policy brand_logo_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'brand-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'brand-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists brand_logo_objects_delete on storage.objects;
create policy brand_logo_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'brand-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Reads are open to everyone, anon included. A logo is fetchable by anyone who
-- has the url, which is the same bargain every public bucket makes; nothing
-- secret is ever uploaded here.
drop policy if exists brand_logo_objects_read on storage.objects;
create policy brand_logo_objects_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'brand-logos');
