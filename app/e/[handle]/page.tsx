import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import {
  asLinkItems,
  asReelClips,
  asStringList,
  normalizeHandle,
  EDITING_ENABLED,
  EDITOR_HIRING_ENABLED,
  type Editor,
} from "@/lib/editing";

/**
 * An editor's public portfolio at ugcflows.com/e/<handle>.
 *
 * Free and anonymous by design: this is the link an editor drops in a bio or a
 * dm, so it goes through a plain anon client (no cookies, so the route can
 * cache) and RLS only surfaces rows where `published` is true.
 */

export const revalidate = 60;

type Props = { params: Promise<{ handle: string }> };

const COLUMNS =
  "user_id, handle, published, name, headline, location, avatar_url, bio, " +
  "skills, software, links, reel, rate_cents, turnaround_hours, status, " +
  "verified, created_at, updated_at";

/**
 * A published editor by handle, case-insensitive. Wrapped in React `cache`
 * because the route asks twice, once for metadata and once to render, and
 * supabase queries are not fetch-memoized. normalizeHandle strips the input to
 * [a-z0-9-], so the value is safe to hand to ilike as a pattern.
 */
const getPublicEditor = cache(async function getPublicEditor(
  raw: string
): Promise<Editor | null> {
  // gated here rather than in the page because both the render and
  // generateMetadata come through this one function, and both already handle a
  // null editor as a 404. Hiring is enough on its own: the portfolio is the
  // thing an applicant builds, and a page they cannot show anyone is not one.
  if (!EDITING_ENABLED && !EDITOR_HIRING_ENABLED) return null;

  const handle = normalizeHandle(raw);
  if (!handle) return null;

  const supabase = createAnonClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    // no session to persist and nowhere to persist it on the server
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data, error } = await supabase
    .from("editors")
    .select(COLUMNS)
    .ilike("handle", handle)
    .eq("published", true)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as Editor;
  return {
    ...row,
    skills: asStringList(row.skills),
    software: asStringList(row.software),
    links: asLinkItems(row.links),
    reel: asReelClips(row.reel),
  };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const editor = await getPublicEditor(handle);

  if (!editor) return { title: "not found · ugc flows", robots: { index: false } };

  const name = editor.name || editor.handle;
  const title = `${name} · video editor`;
  const description =
    editor.headline ||
    editor.bio ||
    [name, "video editor", editor.location].filter(Boolean).join(" · ");
  const images = editor.avatar_url
    ? [{ url: editor.avatar_url, alt: name }]
    : undefined;

  return {
    title,
    description,
    alternates: { canonical: `/e/${editor.handle}` },
    robots: { index: true, follow: true },
    openGraph: {
      type: "profile",
      title,
      description,
      url: `/e/${editor.handle}`,
      siteName: "Creator Empire",
      images,
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: editor.avatar_url ? [editor.avatar_url] : undefined,
    },
  };
}

/** "from $40 per video", whole dollars unless the rate has cents. */
function rateLabel(cents: number): string {
  const dollars = (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
  return `from ${dollars} per video`;
}

function VerifiedBadge() {
  return (
    <span
      title="verified editor"
      className="inline-flex h-5 w-5 items-center justify-center rounded-pill bg-flame text-on-accent"
    >
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
        <path
          d="M2.5 6.2 5 8.7l4.5-5.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="sr-only">verified</span>
    </span>
  );
}

function TagRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-50">
        {label}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item}
            className="rounded-pill border border-line bg-paper px-3.5 py-1.5 text-[13px] font-semibold text-ink-70"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export default async function EditorPortfolioPage({ params }: Props) {
  const { handle } = await params;
  const editor = await getPublicEditor(handle);
  if (!editor) notFound();

  const name = editor.name || editor.handle;
  const taking = editor.status === "active";
  const facts = [
    editor.rate_cents != null && editor.rate_cents > 0
      ? rateLabel(editor.rate_cents)
      : null,
    editor.turnaround_hours != null && editor.turnaround_hours > 0
      ? `about ${editor.turnaround_hours}h turnaround`
      : null,
  ].filter((f): f is string => f !== null);

  return (
    <main className="min-h-dvh bg-shell px-5 py-12 sm:py-16">
      <div className="mx-auto w-full max-w-[640px]">
        {/* who this is */}
        <header className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          {editor.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={editor.avatar_url}
              alt={name}
              className="h-20 w-20 shrink-0 rounded-pill border border-line object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-pill bg-ember text-[26px] font-extrabold text-flame-dark">
              {name.slice(0, 1)}
            </div>
          )}

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[clamp(1.5rem,5vw,2rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
                {name}
              </h1>
              {editor.verified && <VerifiedBadge />}
              <span
                className={`rounded-pill px-3 py-1 text-[12px] font-bold ${
                  taking
                    ? "bg-ember text-flame-dark"
                    : "border border-line text-ink-50"
                }`}
              >
                {taking ? "taking work" : "not taking work"}
              </span>
            </div>

            {editor.headline && (
              <p className="mt-1.5 text-[15px] font-semibold text-ink-70">
                {editor.headline}
              </p>
            )}
            {editor.location && (
              <p className="mt-1 text-[13.5px] text-ink-50">{editor.location}</p>
            )}
          </div>
        </header>

        {/* rate + turnaround */}
        {facts.length > 0 && (
          <p className="mt-6 text-[14px] font-semibold text-ink-70">
            {facts.join(" · ")}
          </p>
        )}

        {/* bio */}
        {editor.bio && (
          <p className="mt-6 whitespace-pre-line text-[15px] leading-[1.65] text-ink-70">
            {editor.bio}
          </p>
        )}

        {/* skills + software */}
        {(editor.skills.length > 0 || editor.software.length > 0) && (
          <div className="mt-9 space-y-6">
            {editor.skills.length > 0 && (
              <TagRow label="skills" items={editor.skills} />
            )}
            {editor.software.length > 0 && (
              <TagRow label="software" items={editor.software} />
            )}
          </div>
        )}

        {/* reel: cards that link out, nothing embedded */}
        {editor.reel.length > 0 && (
          <section className="mt-9">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-50">
              reel
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {editor.reel.map((clip, i) => (
                <a
                  key={`${clip.url}-${i}`}
                  href={clip.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group rounded-card border border-line bg-paper p-4 transition-colors hover:border-flame/45"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50">
                    {clip.platform || "watch"}
                  </p>
                  <p className="mt-1 truncate text-[14.5px] font-semibold text-ink transition-colors group-hover:text-flame">
                    {clip.title || clip.url.replace(/^https?:\/\//, "")}
                  </p>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* elsewhere */}
        {editor.links.length > 0 && (
          <div className="mt-9 flex flex-wrap gap-2">
            {editor.links.map((link, i) => (
              <a
                key={`${link.url}-${i}`}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-pill border border-line bg-paper px-3.5 py-1.5 text-[13px] font-semibold text-ink-70 transition-colors hover:border-flame/45 hover:text-flame"
              >
                {link.label || link.url.replace(/^https?:\/\//, "")}
              </a>
            ))}
          </div>
        )}

        {/* the cta */}
        <div className="mt-12 rounded-card border border-line bg-paper p-6 text-center">
          <p className="text-[15px] font-semibold text-ink">
            want this editor on your videos?
          </p>
          <p className="mt-1 text-[13.5px] text-ink-50">
            post your job on ugc flows and editors like {name} can claim it.
          </p>
          <Link
            href="/login?next=/editing"
            className="mt-4 inline-flex items-center rounded-pill bg-flame px-5 py-2.5 text-[14px] font-bold text-on-accent transition-colors hover:bg-flame-dark"
          >
            post your job
          </Link>
        </div>
      </div>
    </main>
  );
}
