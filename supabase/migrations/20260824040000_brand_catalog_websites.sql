-- Websites and logos for the brands already on file.
--
-- The catalogue in lib/brand-catalog.ts grew from 27 entries to 49 and every
-- entry now carries the brand's own domain and site. New brands pick both up
-- when they are written (resolveBrand in lib/deal-intake.ts). Brands saved
-- before that are sitting there with a letter for a logo and a blank url, and
-- this is the one pass that fixes them.
--
-- Fills blanks only. A brand carrying an uploaded logo_url keeps it and is not
-- given a key; a brand with a website typed in keeps that url. Matching is the
-- same slug rule brandSlug() uses in the app: lowercased, punctuation and
-- spaces removed, so "Wispr Flow", "wisprflow" and "wispr-flow" are one brand.

with catalog(slug, logo_key, website) as (
  values
    ('anara', 'anara', 'https://anara.com'),
    ('asmi', 'asmi', 'https://www.asmiai.com'),
    ('atom', 'atom', 'https://atom.new'),
    ('based', 'based', null),
    ('biggerz', 'biggerz', 'https://biggerz.com'),
    ('blueprint', 'blueprint', 'https://blueprint.io'),
    ('blustu', 'blustu', 'https://blustu.agency'),
    ('breadwinners', 'breadwinners', 'https://www.breadwinnersclub.com'),
    ('calai', 'cal-ai', 'https://www.calai.app'),
    ('candle', 'candle', 'https://www.trycandle.app'),
    ('cantina', 'cantina', 'https://cantina.com'),
    ('codedex', 'codedex', 'https://www.codedex.io'),
    ('coderabbit', 'coderabbit', 'https://www.coderabbit.ai'),
    ('composio', 'composio', 'https://composio.dev'),
    ('folk', 'folk', 'https://www.folk.app'),
    ('gizmo', 'gizmo', 'https://gizmo.ai'),
    ('higgsfield', 'higgsfield', 'https://higgsfield.ai'),
    ('hyperknow', 'hyperknow', 'https://hyperknow.com'),
    ('invo', 'invo', 'https://invoapp.com'),
    ('involio', 'invo', 'https://invoapp.com'),
    ('jobright', 'jobright', 'https://jobright.ai'),
    ('klypr', 'klypr', 'https://klypr.app'),
    ('tryklypr', 'klypr', 'https://klypr.app'),
    ('kreaai', 'krea-ai', 'https://krea.ai'),
    ('launchpoint', 'launchpoint', 'https://www.launchpointhq.com'),
    ('liftoff', 'liftoff', 'https://liftoff.ai'),
    ('lotus', 'lotus', 'https://lotus.app'),
    ('lovable', 'lovable', 'https://lovable.dev'),
    ('loveable', 'lovable', 'https://lovable.dev'),
    ('manus', 'manus', 'https://manus.im'),
    ('mathgpt', 'mathgpt', 'https://math-gpt.org'),
    ('medeo', 'medeo', 'https://www.medeo.app'),
    ('meshyai', 'meshy-ai', 'https://meshy.ai'),
    ('modo', 'modo', 'https://modo.us'),
    ('mosaic', 'mosaic', 'https://motion.so'),
    ('motion', 'mosaic', 'https://motion.so'),
    ('newwave', 'new-wave', 'https://new-wave.ai'),
    ('nook', 'nook', 'https://nookapp.xyz'),
    ('openart', 'open-art', 'https://openart.ai'),
    ('phrasly', 'phrasly', 'https://phrasly.ai'),
    ('pineai', 'pine-ai', 'https://pine.ai'),
    ('plutus', 'plutus', 'https://growwithplutus.com'),
    ('polsia', 'polsia', 'https://polsia.com'),
    ('polymarket', 'polymarket', 'https://polymarket.com'),
    ('pumpfun', 'pumpfun', 'https://pump.fun'),
    ('qotify', 'qotify', 'https://www.qotify.io'),
    ('replit', 'replit', 'https://replit.com'),
    ('spyglass', 'spyglass', 'https://spyglass.so'),
    ('tinynature', 'tiny-nature', 'https://tinynature.com'),
    ('turboai', 'turbo-ai', 'https://turbo.ai'),
    ('wellspoken', 'wellspoken', 'https://www.wellspoken.me'),
    ('wisprflow', 'wispr-flow', 'https://wisprflow.ai'),
    ('zo', 'zo', 'https://www.zo.computer')
)
update public.brands b
set
  -- an uploaded mark is the creator saying "this one", so it is never given a
  -- catalogue key on top of it.
  logo_key = case
    when b.logo_key is null and b.logo_url is null then c.logo_key
    else b.logo_key
  end,
  website = coalesce(nullif(btrim(b.website), ''), c.website),
  updated_at = now()
from catalog c
where lower(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) = c.slug
  and (
    (b.logo_key is null and b.logo_url is null and c.logo_key is not null)
    or (nullif(btrim(b.website), '') is null and c.website is not null)
  );
