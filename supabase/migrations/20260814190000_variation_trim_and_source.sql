-- variations: trim points on a component, and where a sound came from.
--
-- trimming is stored, never baked. the uploaded file stays whole in the bucket
-- and the render worker seeks past what was cut: re-trimming is then a number
-- somebody can change back, rather than a second upload of a file we already
-- destroyed. `duration_seconds` therefore keeps meaning "how long the file is",
-- and how long the SELECTION is comes off these two.
--
-- both null = use the whole clip, which is what every row written before today
-- means and what an untouched upload keeps meaning.
--
-- `source_url` is provenance for a sound pulled off a tiktok / reel / short. it
-- is null for a file somebody uploaded by hand, which is how the card knows
-- whether to show the link chip.

alter table public.variation_components
  add column if not exists trim_start_seconds numeric,
  add column if not exists trim_end_seconds numeric,
  add column if not exists source_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'variation_components_trim_ck'
      and conrelid = 'public.variation_components'::regclass
  ) then
    alter table public.variation_components
      add constraint variation_components_trim_ck check (
        (trim_start_seconds is null or trim_start_seconds >= 0)
        and (
          trim_start_seconds is null
          or trim_end_seconds is null
          or trim_end_seconds > trim_start_seconds
        )
      );
  end if;
end $$;

-- grants on this table are table-level (not column-level), so the three new
-- columns are already readable and writable by `authenticated` and are scoped
-- by the existing `own_rows` policy. nothing to grant.
