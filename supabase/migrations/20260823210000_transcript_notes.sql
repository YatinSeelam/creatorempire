-- Notes on a saved transcript.
--
-- The script pane holds somebody else's words and Reset has to be able to put
-- the provider's original back, so a creator's own thinking cannot live in it:
-- "hook is too long, shoot this one outside" would be wiped by the button that
-- exists to undo a bad edit. A separate column is the whole fix.
--
-- Free text, never parsed, never shown to anyone else. Same rls as the row it
-- sits on, so nothing else here changes.

alter table public.transcripts
  add column if not exists notes text not null default '';
