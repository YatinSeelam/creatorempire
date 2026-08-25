-- What a sound DOES to a video, which until now had exactly one answer.
--
-- `replaceAudio` maps the picked track over the clip's own audio and loops it
-- forever. That is right for one case and one case only: a trending sound
-- pulled off a tiktok, where the sound IS the video. It is wrong for both
-- halves of the house bank that just landed.
--
--   a music bed under a voiceover  -> replace deletes the voiceover
--   a whoosh on the hook/demo cut  -> replace loops the whoosh for 20 seconds
--
-- So a sound now carries a role.
--
--   replace  the sound is the audio. today's behaviour, and the default, so
--            every component that already exists keeps doing what it did.
--   bed      mixed UNDER the clip's own audio at `audio_gain`. the voiceover
--            survives and the music sits behind it.
--   sting    played once, landing on the hook/demo seam. not looped.
--
-- `audio_gain` is only really a question for a bed: "the music is too loud over
-- my voice" is the complaint that has no other fix, and the right level depends
-- on how loud the person filmed themselves. 0.18 is roughly -15dB, which is
-- where a bed sits under speech.
--
-- ---------------------------------------------------------------- the sting
--
-- A sting is deliberately NOT a fifth axis on the batch. Nobody a/b tests two
-- whooshes; they pick one and it goes on all forty renders. An axis would
-- multiply the batch by the number of sfx picked, which is the opposite of what
-- anybody meant. So it is one nullable id on the batch, stamped onto every
-- render it produced, exactly like the text snapshot next to it.
--
-- This is also why `audio_id` and `sfx_id` are two columns rather than one
-- repeated: a render wants a bed AND a whoosh at the same time, and "music plus
-- a transition" is the single most ordinary thing an editor does.

-- ------------------------------------------------------- variation_components

alter table public.variation_components
  add column if not exists audio_role text not null default 'replace';

alter table public.variation_components
  drop constraint if exists variation_components_audio_role_check;
alter table public.variation_components
  add constraint variation_components_audio_role_check
  check (audio_role in ('replace', 'bed', 'sting'));

alter table public.variation_components
  add column if not exists audio_gain numeric not null default 1;

alter table public.variation_components
  drop constraint if exists variation_components_audio_gain_check;
alter table public.variation_components
  add constraint variation_components_audio_gain_check
  check (audio_gain > 0 and audio_gain <= 2);

-- the sting picker reads this, and on a bank with forty sounds in it the
-- partial index is the difference between a scan and a lookup.
create index if not exists variation_components_sting_idx
  on public.variation_components (brand_id, created_at desc)
  where kind = 'audio' and audio_role = 'sting';

-- --------------------------------------------------------- batches + renders

-- on delete set null, like the four ids already there: pulling a sound out of
-- the bank must not delete the record of the videos it was used on.
alter table public.variation_batches
  add column if not exists sfx_id uuid
  references public.variation_components (id) on delete set null;

alter table public.variation_batches
  add column if not exists sfx_title text;

alter table public.variation_renders
  add column if not exists sfx_id uuid
  references public.variation_components (id) on delete set null;
