-- Brands get a face and a file.
--
-- Two logo columns rather than one, because they answer different questions.
-- `logo_key` points at an entry in lib/brand-catalog.ts, so the brand keeps its
-- mark even when the catalogue swaps the file behind that key. `logo_url` is
-- the escape hatch for a brand the list has never heard of. Both null is the
-- normal case and renders the brand's initial, never a broken image.
--
-- The catalogue is a convenience, never a whitelist: a brand missing from it is
-- a slower path, not a blocked one. That is why neither column is constrained
-- against it and neither is required.
alter table public.brands
  add column if not exists logo_key text,
  add column if not exists logo_url text;
