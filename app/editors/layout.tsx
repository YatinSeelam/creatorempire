import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Mark } from "@/components/art";
import { column } from "@/components/dash/ui";
import { EditorSideNav } from "@/components/editors/side-nav";
import { brand } from "@/lib/content";
import { EDITOR_HIRING_ENABLED, EDITOR_MARKET_ENABLED } from "@/lib/editing";
import { loadNotifications } from "@/lib/notify-server";
import { createClient } from "@/lib/supabase/server";
import { toViewer } from "@/lib/viewer";
import { cookies } from "next/headers";
import { readTheme, THEME_COOKIE } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Editors · Creator Empire",
};

/**
 * The editor shell. Two of them, actually: signed in you get the same chrome as
 * the creator dash, signed out you get a plain page with a wordmark.
 *
 * Signed out is a first-class state here and used to be a redirect to /login.
 * The link in this group's overview is the one that gets pasted into a discord
 * server, so a stranger clicking it has to land on the job post, not on a login
 * form for a product they have never heard of.
 *
 * Every page under this still checks for itself: the market pages want
 * EDITING_ENABLED and a session, and neither is proven by rendering inside this.
 */
export default async function EditorsLayout({
  children,
}: {
  children: ReactNode;
}) {
  // the shell paints in the right colours on the first paint, so there is no
  // flash of white to hide behind a script. see lib/theme.ts for why this is a
  // cookie rather than a column.
  const theme = readTheme((await cookies()).get(THEME_COOKIE)?.value);

  // both halves off means the group is not there at all. before the session
  // read on purpose: a hidden feature must not touch auth to 404.
  // EDITING_ENABLED is the CREATOR's half and stays on here; this group is the
  // editor's, so it is the market and hiring flags that decide it. both off
  // means the tree is not there at all.
  if (!EDITOR_MARKET_ENABLED && !EDITOR_HIRING_ENABLED) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="dash-shell min-h-dvh bg-shell" data-theme={theme}>
        <header className="border-b border-line">
          {/* same horizontal padding as <main>, so the header's edges line up
              with the page instead of the sign-in link touching the viewport */}
          <div className="px-5 sm:px-6">
            <div
              className={`${column} flex items-center justify-between gap-4 py-4`}
            >
              <Link
                href="/editors"
                className="flex items-center gap-2.5 text-[17px] font-extrabold tracking-[-0.02em]"
              >
                <Mark className="size-7" />
                <span>
                  {brand.wordmark} <span className="text-flame">editors</span>
                </span>
              </Link>
              <Link
                href="/login?next=/editors"
                className="rounded-pill border border-line px-4 py-1.5 text-[13.5px] font-semibold text-ink-70 transition-colors hover:border-flame hover:text-ink"
              >
                sign in
              </Link>
            </div>
          </div>
        </header>
        <main className="px-5 py-10 sm:px-6">
          <div className={column}>{children}</div>
        </main>
      </div>
    );
  }

  // the rail's "my public page" link, present only once the profile is live
  const [{ data: editor }, { data: isFounder }, bell] = await Promise.all([
    supabase
      .from("editors")
      .select("handle, published")
      .eq("user_id", user.id)
      .maybeSingle(),
    // the rail is a client component, so the founder question gets answered
    // here and handed down. same bypass the board and the desk already use.
    supabase.rpc("am_i_admin"),
    // the same bell the creator rail carries: one table, two shells.
    loadNotifications(),
  ]);
  const publicHref =
    editor?.published && editor.handle ? `/e/${editor.handle}` : null;

  return (
    <div className="dash-shell min-h-dvh bg-shell" data-theme={theme}>
      <EditorSideNav
        viewer={toViewer(user)}
        publicHref={publicHref}
        marketOpen={EDITOR_MARKET_ENABLED || isFounder === true}
        notifications={bell.rows}
        unreadNotifications={bell.unread}
      />
      {/* unlike the dash, no editor page has an edge-to-edge top bar, so the
          column can live here instead of in a Page primitive */}
      <main className="px-5 py-7 sm:px-6 lg:ml-[224px]">
        {/* the extra div the dash does not have: over there Page owns `column`,
            here the layout does. so it has to pass the height through, or a
            page marked page-fill would size itself against a wrapper that is
            still as tall as its content. inert unless main became a flex
            column, which only a .page-fill child does. */}
        <div className={`${column} lg:flex lg:min-h-0 lg:flex-1 lg:flex-col`}>
          {children}
        </div>
      </main>
    </div>
  );
}
