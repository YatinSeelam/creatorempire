-- Brands created before the variations tool matched the catalogue were saved
-- with no logo_key, so every surface drew their initial even though the mark
-- was sitting in public/brands the whole time.
--
-- Only rows carrying neither a key nor an uploaded url are touched: a creator
-- who uploaded their own mark keeps it, and a key already set is already right.
-- The slug rule is the one lib/brand-catalog.ts uses, punctuation and case
-- stripped, so "Wispr Flow" and "wisprflow" collapse to the same string.
-- "loveable" is the one deliberate alias, a misspelling common enough to type.

with catalog(key, slug) as (
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
    ('lovable', 'loveable'),
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
)
update brands b
set logo_key = c.key
from catalog c
where b.logo_key is null
  and (b.logo_url is null or b.logo_url = '')
  and lower(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) = c.slug;
