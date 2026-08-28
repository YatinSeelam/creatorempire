import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PortfolioSite } from "@/components/portfolio/portfolio-site";
import { getPublicPortfolio, getPublicPortfolioAgency } from "@/lib/portfolio";
import { portfolioFontVars } from "@/lib/portfolio-fonts";
import { themeVars } from "@/lib/portfolio-theme";

/**
 * A creator's portfolio, at the root of the domain: creatorempire.app/<slug>.
 *
 * It sits at the root because that is the address a creator actually hands to a
 * brand. Every static route in the app beats a dynamic segment in Next's
 * matcher, and RESERVED_SLUGS in portfolio-schema refuses the names that would
 * otherwise produce a page nobody can reach.
 *
 * There is no `home` column here and no redirect to a second address, unlike
 * the copy of this route inside ugc flows. That deploy renders the same table
 * at two paths and has to say which one owns a page; this one is the only thing
 * serving its database, so a portfolio has nowhere else it could be.
 */

/**
 * A minute of staleness is all a portfolio needs: it changes when its owner
 * saves, and a brand reading it a minute behind has lost nothing.
 */
export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const p = await getPublicPortfolio(slug);

  // an unpublished or missing slug still renders not-found, so keep it out of
  // the index rather than letting a 404 accrue link equity
  if (!p) return { title: "Not found · Creator Empire", robots: { index: false } };

  const name = p.name || p.slug;
  const title = p.role ? `${name} · ${p.role}` : name;
  const description =
    p.about ||
    [p.role, p.location].filter(Boolean).join(" · ") ||
    `${name} on Creator Empire`;

  const images = p.avatarUrl ? [{ url: p.avatarUrl, alt: name }] : undefined;

  return {
    title,
    description,
    alternates: { canonical: `/${p.slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      type: "profile",
      title,
      description,
      url: `/${p.slug}`,
      siteName: "Creator Empire",
      images,
    },
    twitter: {
      card: images ? "summary" : "summary_large_image",
      title,
      description,
      images: p.avatarUrl ? [p.avatarUrl] : undefined,
    },
  };
}

export default async function CreatorPortfolioPage({ params }: Props) {
  const { slug } = await params;
  // both reads are `cache`d and generateMetadata already asked for the first,
  // so this pair costs one round trip, not three.
  const [p, agency] = await Promise.all([
    getPublicPortfolio(slug),
    getPublicPortfolioAgency(slug),
  ]);
  if (!p) notFound();

  return (
    // the theme vars live out here, not on the template, so the creator's own
    // background reaches the edges of the window rather than stopping at the
    // reading column. the template sets them again on itself, which is what
    // lets the editor drop it into a phone with no wrapper of its own.
    <main
      className={`min-h-dvh w-full ${portfolioFontVars}`}
      style={themeVars(p.theme)}
    >
      <PortfolioSite portfolio={p} mode="live" agency={agency} />
    </main>
  );
}
