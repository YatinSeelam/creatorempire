/**
 * The brands a creator can pick off a list when building their portfolio,
 * instead of hunting down a logo and uploading it themselves.
 *
 * This is a convenience, not a whitelist. A creator who worked with a brand
 * that is not on this list still adds it, they just type its site and let the
 * favicon stand in, or upload their own mark. So a missing brand is a slower
 * path, never a blocked one, and that is why there is no pressure to make this
 * list exhaustive.
 *
 * `key` is what a saved portfolio stores, so it is the one field that can
 * never change once it has shipped. Renaming a key orphans it on every
 * portfolio that already picked it. `name`, `logo`, `domain` and `website` are
 * display concerns and are safe to correct at any time.
 *
 * Two kinds of logo live here. A path under `/brands/` is a real file somebody
 * chose: one square-ish mark per brand that reads at thumbnail size and carries
 * its own background, picked once here so no surface has to make that call at
 * render time. Everything else is the brand's own favicon, resolved from its
 * domain. A favicon is still the brand's real mark, just smaller, which is why
 * it beats a blank tile. Placeholder art does not belong in either group: see
 * the note on Cooksat below.
 */

export type CuratedBrand = {
  /** stable key, kebab-case. never change one once shipped, portfolios store it. */
  key: string;
  name: string;
  /** path under /public (e.g. "/brands/candle.png") or an absolute favicon url. */
  logo: string;
  /**
   * Spellings that mean this brand and nothing else. Only for misspellings
   * common enough to be typed on purpose, never for a name another company
   * could plausibly have: a wrong logo is worse than none.
   */
  aliases?: string[];
  /** apex domain, no protocol and no `www.`. the brand's identity on the web. */
  domain?: string;
  /** full url, for linking out. */
  website?: string;
  /** press kit or brand assets page, where one exists. */
  brandKit?: string;
};

/** Google's favicon service. No key, no CORS, works for any live domain. */
export function faviconLogo(domain: string, size = 128): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

/**
 * Second chance for a favicon that 404s or renders blank. DuckDuckGo serves the
 * site's apple-touch-icon, which plenty of sites have when the plain favicon is
 * missing, so it is worth one retry before falling back to the initial.
 */
export function fallbackLogo(domain: string): string {
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
}

export const CURATED_BRANDS: CuratedBrand[] = [
  { key: "anara", name: "Anara", logo: "/brands/anara.png", domain: "anara.com", website: "https://anara.com" },
  { key: "asmi", name: "Asmi", logo: faviconLogo("asmiai.com"), domain: "asmiai.com", website: "https://www.asmiai.com" },
  { key: "atom", name: "Atom", logo: faviconLogo("atom.new"), domain: "atom.new", website: "https://atom.new" },
  { key: "based", name: "Based", logo: "/brands/based.svg" },
  { key: "biggerz", name: "Biggerz", logo: "/brands/biggerz.png", aliases: ["bigger z"], domain: "biggerz.com", website: "https://biggerz.com" },
  { key: "blueprint", name: "Blueprint", logo: faviconLogo("blueprint.io"), domain: "blueprint.io", website: "https://blueprint.io" },
  { key: "blustu", name: "BluStu", logo: "/brands/blustu.png", domain: "blustu.agency", website: "https://blustu.agency" },
  { key: "breadwinners", name: "Breadwinners", logo: "/brands/breadwinners.jpg", domain: "breadwinnersclub.com", website: "https://www.breadwinnersclub.com" },
  { key: "cal-ai", name: "Cal AI", logo: faviconLogo("calai.app"), domain: "calai.app", website: "https://www.calai.app" },
  { key: "candle", name: "Candle", logo: "/brands/candle.png", domain: "trycandle.app", website: "https://www.trycandle.app" },
  { key: "cantina", name: "Cantina", logo: faviconLogo("cantina.com"), domain: "cantina.com", website: "https://cantina.com" },
  { key: "codedex", name: "Codedex", logo: "/brands/codedex.png", domain: "codedex.io", website: "https://www.codedex.io" },
  { key: "coderabbit", name: "CodeRabbit", logo: faviconLogo("coderabbit.ai"), domain: "coderabbit.ai", website: "https://www.coderabbit.ai" },
  { key: "composio", name: "Composio", logo: "/brands/composio.png", domain: "composio.dev", website: "https://composio.dev" },
  // Cooksat is deliberately absent. The only asset for it was placeholder art,
  // a grey square with a letter in it, and a creator sending a portfolio to a
  // brand is better served by no logo than by a fake one. Add it back the day a
  // real mark turns up.
  { key: "folk", name: "Folk", logo: "/brands/folk.png", domain: "folk.app", website: "https://www.folk.app" },
  { key: "gizmo", name: "Gizmo", logo: faviconLogo("gizmo.ai"), domain: "gizmo.ai", website: "https://gizmo.ai" },
  { key: "higgsfield", name: "Higgsfield", logo: faviconLogo("higgsfield.ai"), domain: "higgsfield.ai", website: "https://higgsfield.ai", brandKit: "https://asvg.app/icons/higgsfield" },
  { key: "hyperknow", name: "Hyperknow", logo: "/brands/hyperknow.png", domain: "hyperknow.com", website: "https://hyperknow.com" },
  { key: "invo", name: "Invo", logo: faviconLogo("invoapp.com"), aliases: ["involio"], domain: "invoapp.com", website: "https://invoapp.com" },
  { key: "jobright", name: "Jobright", logo: faviconLogo("jobright.ai"), domain: "jobright.ai", website: "https://jobright.ai" },
  { key: "klypr", name: "Klypr", logo: faviconLogo("klypr.app"), aliases: ["tryklypr"], domain: "klypr.app", website: "https://klypr.app" },
  { key: "krea-ai", name: "Krea AI", logo: faviconLogo("krea.ai"), domain: "krea.ai", website: "https://krea.ai", brandKit: "https://www.krea.ai/press" },
  { key: "launchpoint", name: "Launchpoint", logo: "/brands/launchpoint.svg", domain: "launchpointhq.com", website: "https://www.launchpointhq.com" },
  { key: "liftoff", name: "Liftoff", logo: "/brands/liftoff.png", domain: "liftoff.ai", website: "https://liftoff.ai" },
  { key: "lotus", name: "Lotus", logo: "/brands/lotus.png", domain: "lotus.app", website: "https://lotus.app" },
  { key: "lovable", name: "Lovable", logo: "/brands/lovable.png", aliases: ["loveable"], domain: "lovable.dev", website: "https://lovable.dev" },
  { key: "manus", name: "Manus", logo: "/brands/manus.png", domain: "manus.im", website: "https://manus.im" },
  { key: "mathgpt", name: "MathGPT", logo: "/brands/mathgpt.png", domain: "math-gpt.org", website: "https://math-gpt.org" },
  { key: "medeo", name: "Medeo", logo: faviconLogo("medeo.app"), domain: "medeo.app", website: "https://www.medeo.app" },
  { key: "meshy-ai", name: "Meshy AI", logo: faviconLogo("meshy.ai"), domain: "meshy.ai", website: "https://meshy.ai", brandKit: "https://www.meshy.ai/media-kit" },
  { key: "modo", name: "Modo", logo: faviconLogo("modo.us"), domain: "modo.us", website: "https://modo.us" },
  // "Motion" and "Mosaic" are one brand on the rate sheet, filed under the key
  // that shipped first.
  { key: "mosaic", name: "Mosaic", logo: "/brands/mosaic.svg", aliases: ["motion"], domain: "motion.so", website: "https://motion.so" },
  { key: "new-wave", name: "New Wave", logo: "/brands/new-wave.png", domain: "new-wave.ai", website: "https://new-wave.ai" },
  { key: "nook", name: "Nook", logo: faviconLogo("nookapp.xyz"), domain: "nookapp.xyz", website: "https://nookapp.xyz" },
  { key: "open-art", name: "Open Art", logo: faviconLogo("openart.ai"), aliases: ["openart"], domain: "openart.ai", website: "https://openart.ai" },
  { key: "phrasly", name: "Phrasly", logo: "/brands/phrasly.png", domain: "phrasly.ai", website: "https://phrasly.ai" },
  { key: "pine-ai", name: "Pine AI", logo: "/brands/pine-ai.svg", domain: "pine.ai", website: "https://pine.ai" },
  { key: "plutus", name: "Plutus", logo: "/brands/plutus.png", domain: "growwithplutus.com", website: "https://growwithplutus.com" },
  { key: "polsia", name: "Polsia", logo: faviconLogo("polsia.com"), domain: "polsia.com", website: "https://polsia.com" },
  { key: "polymarket", name: "Polymarket", logo: "/brands/polymarket.png", domain: "polymarket.com", website: "https://polymarket.com" },
  { key: "pumpfun", name: "Pump.fun", logo: faviconLogo("pump.fun"), aliases: ["pumpfun", "pump fun"], domain: "pump.fun", website: "https://pump.fun" },
  { key: "qotify", name: "Qotify", logo: faviconLogo("qotify.io"), domain: "qotify.io", website: "https://www.qotify.io" },
  { key: "replit", name: "Replit", logo: faviconLogo("replit.com"), domain: "replit.com", website: "https://replit.com" },
  { key: "spyglass", name: "Spyglass", logo: faviconLogo("spyglass.so"), domain: "spyglass.so", website: "https://spyglass.so" },
  { key: "tiny-nature", name: "Tiny Nature", logo: "/brands/tiny-nature.svg", domain: "tinynature.com", website: "https://tinynature.com" },
  { key: "turbo-ai", name: "Turbo AI", logo: "/brands/turbo.png", domain: "turbo.ai", website: "https://turbo.ai" },
  { key: "wellspoken", name: "Wellspoken", logo: "/brands/wellspoken.png", domain: "wellspoken.me", website: "https://www.wellspoken.me" },
  { key: "wispr-flow", name: "Wispr Flow", logo: "/brands/wispr-flow.svg", domain: "wisprflow.ai", website: "https://wisprflow.ai" },
  { key: "zo", name: "Zo", logo: faviconLogo("zo.computer"), domain: "zo.computer", website: "https://www.zo.computer" },
];

/**
 * The one form two spellings of a brand collapse to.
 *
 * "Wispr Flow", "wisprflow" and "wispr-flow" are the same brand to the person
 * typing, so everything that compares brand names compares slugs instead:
 * search, "do I already have this brand", and matching a typed name against the
 * catalogue. Punctuation goes with the spaces, which is what makes the `key`
 * and the `name` of every entry above slug to the same string.
 */
export function brandSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** substring match on name, for the picker's search box. */
export function searchBrands(query: string): CuratedBrand[] {
  // An empty box means the creator has not narrowed anything yet, so show the
  // whole list rather than nothing.
  const q = brandSlug(query);
  if (!q) return CURATED_BRANDS;
  return CURATED_BRANDS.filter(
    (b) =>
      brandSlug(b.name).includes(q) ||
      b.key.includes(q) ||
      (b.domain ? brandSlug(b.domain).includes(q) : false)
  );
}

export function findBrand(key: string): CuratedBrand | undefined {
  return CURATED_BRANDS.find((b) => b.key === key);
}

/**
 * Pull an apex domain out of anything somebody might paste: a full url, a
 * `www.` host, a url with a path, or an email address. Returns null when the
 * input is a plain brand name rather than a web address, which is what lets
 * one field accept both.
 */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s || /\s/.test(s)) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0];
  if (s.includes("@")) s = s.split("@").pop() ?? "";
  s = s.replace(/^www\./, "").replace(/\.$/, "");
  if (!/^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(s)) return null;
  // A trailing all-letter label keeps "krea.ai" in and "v1.2" out.
  const tld = s.split(".").pop() ?? "";
  if (!/^[a-z]{2,}$/.test(tld)) return null;
  return s;
}

/**
 * A name someone typed, matched against the catalogue.
 *
 * This is what makes "candle" come back with Candle's logo attached without the
 * creator picking it off a grid, and it is the same lookup the server does when
 * a brand arrives from a form or, later, from an AI proposal. Exact on the slug
 * only: a substring match here would hand "New Wave" to anyone typing "wave",
 * and a wrong logo is worse than none.
 *
 * A pasted url is matched on its domain, so "https://krea.ai/pricing" finds
 * Krea the same way typing "krea" does.
 */
export function matchCuratedBrand(name: string): CuratedBrand | undefined {
  const slug = brandSlug(name);
  if (!slug) return undefined;
  const byName = CURATED_BRANDS.find(
    (b) =>
      brandSlug(b.name) === slug ||
      b.key === slug ||
      (b.aliases ?? []).some((a) => brandSlug(a) === slug)
  );
  if (byName) return byName;
  const domain = normalizeDomain(name);
  if (!domain) return undefined;
  return CURATED_BRANDS.find((b) => b.domain === domain);
}

/** "trycandle.app" -> "Trycandle". Only used for brands nobody has catalogued. */
export function nameFromDomain(domain: string): string {
  const base = (domain.split(".")[0] ?? "").replace(/[-_]+/g, " ").trim();
  if (!base) return domain;
  return base
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export type BrandIdentity = {
  name: string;
  website: string;
  logo: string;
  domain: string;
  /** the catalogue entry, when the match came from one. */
  curated?: CuratedBrand;
};

/**
 * Name, site and logo for whatever the creator typed.
 *
 * One field takes both a brand name and a url, because that is how people
 * actually reach for a brand: some know it by name, some have the tab open. A
 * catalogue hit wins. Otherwise, anything that parses as a domain still gets a
 * site and a favicon, so a brand nobody has catalogued is not stuck with a
 * blank tile. Returns null when the input is neither.
 */
export function resolveBrandIdentity(input: string): BrandIdentity | null {
  const curated = matchCuratedBrand(input);
  if (curated?.domain) {
    return {
      name: curated.name,
      website: curated.website ?? `https://${curated.domain}`,
      logo: curated.logo,
      domain: curated.domain,
      curated,
    };
  }
  const domain = normalizeDomain(input);
  if (!domain) return null;
  return {
    name: curated?.name ?? nameFromDomain(domain),
    website: `https://${domain}`,
    logo: curated?.logo ?? faviconLogo(domain),
    domain,
    curated,
  };
}

/**
 * The image to draw for a saved brand. Key first, because a catalogue entry can
 * have its file corrected under it and every brand pointing at the key picks
 * the correction up; an uploaded url is fixed forever. "" means draw the
 * initial, which is always better than a broken image.
 *
 * Deliberately does not fall back to matching the brand's name or its website.
 * Name matching happens once, when the brand is written (`resolveBrand()`), and
 * the answer is stored. A resolver that re-matched on every read would mean a
 * creator could never clear a logo off a brand whose name is in the catalogue:
 * the clear would save, and the next render would put it straight back.
 */
export function brandLogo(brand: { logo_key?: string | null; logo_url?: string | null }): string {
  if (brand.logo_key) {
    const found = findBrand(brand.logo_key);
    if (found) return found.logo;
  }
  return brand.logo_url ?? "";
}

/**
 * The logo to write for a brand being saved for the first time.
 *
 * A catalogue hit is stored as a key, never a url, so the mark can be corrected
 * later under every brand that points at it. A brand the catalogue has never
 * heard of falls back to its own site's favicon, which is the difference
 * between a new brand showing its mark and showing a letter.
 */
export function logoForNewBrand(
  name: string,
  website?: string | null
): { logo_key: string | null; logo_url: string | null } {
  const curated = matchCuratedBrand(name);
  if (curated) return { logo_key: curated.key, logo_url: null };
  const domain = normalizeDomain(website ?? "") ?? normalizeDomain(name);
  if (domain) return { logo_key: null, logo_url: faviconLogo(domain) };
  return { logo_key: null, logo_url: null };
}
