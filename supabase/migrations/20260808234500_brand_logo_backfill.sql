-- Give the brands that predate `logo_key` the mark they should have had.
--
-- Name matching happens exactly once per brand, on write, and the answer is
-- stored. Brands created before the column existed never got that pass, so this
-- is that pass, run once. A resolver that matched names on every read would be
-- simpler and wrong: a creator could never clear a logo off a brand whose name
-- is in the catalogue, because the clear would save and the next render would
-- put it straight back.
--
-- The slug on the right is the same normalisation `brandSlug()` does in
-- lib/brand-catalog.ts: lowercased, everything that is not a letter or a digit
-- removed, so "Wispr Flow", "wisprflow" and "wispr-flow" are one brand. Keys
-- come from that file and are stable by contract, so this list cannot rot the
-- way a list of file paths would.
--
-- `where logo_key is null and logo_url is null` is what makes it safe to run
-- twice and what stops it overwriting a mark someone picked by hand.
update public.brands b
set logo_key = c.key
from (
  values
    ('anara', 'anara'),
    ('based', 'based'),
    ('biggerz', 'biggerz'),
    ('blustu', 'blustu'),
    ('breadwinners', 'breadwinners'),
    ('candle', 'candle'),
    ('codedex', 'codedex'),
    ('composio', 'composio'),
    ('folk', 'folk'),
    ('hyperknow', 'hyperknow'),
    ('launchpoint', 'launchpoint'),
    ('liftoff', 'liftoff'),
    ('lotus', 'lotus'),
    ('lovable', 'lovable'),
    ('manus', 'manus'),
    ('mathgpt', 'mathgpt'),
    ('mosaic', 'mosaic'),
    ('new-wave', 'newwave'),
    ('phrasly', 'phrasly'),
    ('pine-ai', 'pineai'),
    ('plutus', 'plutus'),
    ('polymarket', 'polymarket'),
    ('tiny-nature', 'tinynature'),
    ('turbo-ai', 'turboai'),
    ('wellspoken', 'wellspoken'),
    ('wispr-flow', 'wisprflow')
) as c (key, slug)
where b.logo_key is null
  and b.logo_url is null
  and regexp_replace(lower(b.name), '[^a-z0-9]', '', 'g') = c.slug;
