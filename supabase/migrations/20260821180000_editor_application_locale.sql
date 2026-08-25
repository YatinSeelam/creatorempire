-- the onboarding wizard asks where an editor is and what they speak, because
-- assignment and communication both care. free text on purpose: a country
-- picker that fights someone's answer is worse than their own words.
alter table public.editor_applications
  add column country text,
  add column timezone text,
  add column languages text;

-- the table is column-granted (status stays staff-only), so the new answers
-- need their own grants or the wizard's writes bounce.
grant insert (country, timezone, languages) on public.editor_applications to authenticated;
grant update (country, timezone, languages) on public.editor_applications to authenticated;
