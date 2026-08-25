/**
 * The portfolio's read layer. Two callers, two very different trust levels.
 *
 * The editor reads the signed-in creator's own row, published or not, through
 * the owner RLS policy. The public page at /:slug reads with no session at all
 * and gets a row only because `published` is true. Both go through the same
 * publishable-key client, so there is no service key in this feature anywhere.
 *
 * Neither function ever writes. A creator who has never saved gets an empty
 * portfolio seeded from their auth record, and the row appears the first time
 * they press save. Creating a blank row on page load would burn a slug and put
 * an unpublished ghost in the table for everyone who merely looked at the tab.
 */

import { cache } from "react";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  emptyPortfolio,
  fromRow,
  slugify,
  type Portfolio,
  type PortfolioRow,
} from "@/lib/portfolio-schema";
import { asPortfolioAgency, type PortfolioAgency } from "@/lib/org-overrides";
import { toViewer } from "@/lib/viewer";

const COLUMNS =
  "user_id, slug, published, name, role, location, cohort, avatar_url, about, " +
  "background, email, phone, cta_label, skills, socials, clips, clients, theme";

/**
 * There is no CI here that applies migrations before a deploy, so code can and
 * does reach production a few minutes ahead of its schema. A missing table is
 * therefore "no portfolio yet", not a 500 on somebody's dashboard.
 */
function missingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    /relation .* does not exist/i.test(error.message ?? "")
  );
}

/** The signed-in creator's portfolio, or a blank one seeded from their account. */
export async function loadPortfolio(): Promise<Portfolio> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return emptyPortfolio();

  // the name and email the editor pre-fills with. a creator who signed up with
  // google already told us both, and typing them again is friction for nothing.
  const viewer = toViewer(user);
  const seed = { name: viewer.name, email: user.email ?? "" };

  const { data, error } = await supabase
    .from("portfolios")
    .select(COLUMNS)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error && !missingTable(error)) throw error;
  if (!data) return emptyPortfolio(seed);

  return fromRow(data as unknown as PortfolioRow, seed);
}

/**
 * A published portfolio by its link, for the public route.
 *
 * Case-insensitive because people share the address by typing it, and the
 * unique index is on lower(slug) so at most one row can ever match. The path
 * segment is put through slugify first, which both normalises the case and
 * leaves only [a-z0-9-] - the value goes into an ilike, and a slug someone
 * typed with a `%` in it would otherwise be a pattern rather than a name.
 *
 * The `published` filter is belt and braces: the RLS policy already hides
 * drafts from an anonymous reader, but the owner viewing their own draft's
 * public url should see the same 404 everyone else does.
 *
 * Two deliberate differences from `loadPortfolio`. It uses a plain anon client
 * rather than the cookie-reading one, because reading cookies forces the route
 * dynamic and this page is the same for everybody who asks for it - a portfolio
 * nobody is signed in to see is exactly the kind of page that should sit in a
 * cache. And it is wrapped in React `cache`, because the route calls it twice,
 * once for `generateMetadata` and once to render, and supabase queries are not
 * fetch-memoized the way a plain fetch would be.
 */
export const getPublicPortfolio = cache(async function getPublicPortfolio(
  slug: string
): Promise<Portfolio | null> {
  const wanted = slugify(slug);
  if (!wanted) return null;

  const supabase = createAnonClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    // no session to persist and nowhere to persist it. left on, supabase-js
    // reaches for storage that does not exist on the server.
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data, error } = await supabase
    .from("portfolios")
    .select(COLUMNS)
    .ilike("slug", wanted)
    .eq("published", true)
    .maybeSingle();

  if (error && !missingTable(error)) throw error;
  if (!data) return null;

  return fromRow(data as unknown as PortfolioRow);
});

/**
 * The workspace a published portfolio signs off as, if any.
 *
 * A creator seated on an agency whose founder set up portfolios (footer,
 * badge: lib/org-overrides.ts) gets that on their public page. Read through the
 * same anon client and the `portfolio_agency_for` definer rpc, which names an
 * org only when it has portfolio.* rows and returns nothing else about it than
 * the branding columns anon could already read. Two reads, both cheap, and
 * `cache`d for the same reason as `getPublicPortfolio`: the route asks twice.
 */
export const getPublicPortfolioAgency = cache(async function getPublicPortfolioAgency(
  slug: string
): Promise<PortfolioAgency | null> {
  const wanted = slugify(slug);
  if (!wanted) return null;

  const supabase = createAnonClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: row } = await supabase
    .from("portfolios")
    .select("user_id")
    .ilike("slug", wanted)
    .eq("published", true)
    .maybeSingle();
  if (!row?.user_id) return null;

  return agencyFor(supabase, row.user_id as string);
});

/** The same answer for the signed-in creator, so the editor's preview shows it. */
export async function loadPortfolioAgency(): Promise<PortfolioAgency | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return agencyFor(supabase, user.id);
}

async function agencyFor(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
  userId: string
): Promise<PortfolioAgency | null> {
  // a deploy running ahead of the migration has no rpc: no agency, not no page.
  const { data, error } = await supabase.rpc("portfolio_agency_for", { p_user: userId });
  if (error) return null;
  return asPortfolioAgency(data);
}
