import Link from "next/link";
import type { ReactNode } from "react";
import { DashBar, Page, Panel, Pill, Row, barTitle } from "@/components/dash/ui";
import {
  DeleteAccount,
  NotificationToggle,
  PhoneForm,
  ProfileForm,
} from "@/components/dash/settings-controls";
import { support } from "@/lib/content";
import { requireViewer } from "@/lib/access";
import { ThemePicker } from "@/components/dash/theme-picker";
import { readTheme, THEME_COOKIE } from "@/lib/theme";
import { cookies } from "next/headers";

export const metadata = { title: "Settings · Creator Empire" };

// billing state is per-request and must never come out of a cache.
export const dynamic = "force-dynamic";

/**
 * One page, four tabs, and the tab lives in the url.
 *
 * The version this replaced was every setting stacked in a two column grid, so
 * "where do I change my handle" and "have I paid" were the same wall of cards
 * and neither was findable. Tabs split it by the question being asked instead.
 *
 * They are Links, not state: a server component renders one panel set, there is
 * no client bundle for the strip, and a tab is a url somebody can be sent to.
 */

const TABS = [
  { id: "profile", label: "Profile" },
  // its own tab rather than a card under the profile form. what the rail
  // carries and what colour the app is are not facts about you, they are the
  // shape of the tool — and together they are long enough to bury the four
  // fields somebody actually came to this page for.
  { id: "account", label: "Account" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const icons: Record<TabId, ReactNode> = {
  profile: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  // a rail and two panels beside it: the thing being switched on and off.
  account: (
    <>
      <rect x="4" y="10.5" width="16" height="10.5" rx="2.5" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </>
  ),
};

const notifications = [
  {
    name: "notify_deals",
    label: "New deal offers",
    note: "Email me the moment a brand picks me",
  },
  {
    name: "notify_edits",
    label: "Editor delivered a cut",
    note: "Ping me when a video is ready to approve",
  },
  {
    name: "notify_posts",
    label: "Auto-post reminders",
    note: "Tell me before a scheduled post goes out",
  },
] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ tab: rawTab }, { supabase, user, isFounder, paid, memberships }] = await Promise.all([
    searchParams,
    requireViewer("/settings"),
  ]);

  const jar = await cookies();
  const theme = readTheme(jar.get(THEME_COOKIE)?.value);

  // an unknown tab is the first one, not an empty page.
  // the notifications tab is hidden with its bell. a settings page for a bell
  // nobody can see is a page that answers a question nobody is asking.
  const visibleTabs = TABS;

  const tab: TabId =
    (visibleTabs.find((t) => t.id === rawTab)?.id as TabId | undefined) ?? "profile";

  const [{ data: profile }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "full_name, handle, niche, created_at, notify_deals, notify_edits, notify_posts, phone"
      )
      .eq("id", user.id)
      .single(),
  ]);

  // how they signed in. google fills this, an email signup says "email".
  const provider = (user.app_metadata?.provider as string | undefined) ?? "email";
  const since = new Date(profile?.created_at ?? user.created_at);

  return (
    <>
      <DashBar lead={<h1 className={barTitle}>Settings</h1>} />

      <Page>
        {/* full bleed on a phone so the last tab can be scrolled to instead of
            being clipped by the layout's gutter. */}
        <nav
          aria-label="Settings sections"
          className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:px-0"
        >
          {visibleTabs.map((t) => {
            const on = t.id === tab;
            return (
              <Link
                key={t.id}
                href={t.id === "profile" ? "/settings" : `/settings?tab=${t.id}`}
                aria-current={on ? "page" : undefined}
                className={`flex h-10 shrink-0 items-center gap-2 rounded-pill border px-4 text-[14px] font-semibold transition-colors ${
                  on
                    ? "border-flame/30 bg-ember text-flame"
                    : "border-line text-ink-50 hover:text-ink"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-[17px] shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {icons[t.id]}
                </svg>
                {t.label}
              </Link>
            );
          })}
        </nav>

        {/* one column. these are forms and fact lists, and neither reads at
            1600px wide on the monitor the shell allows for. */}
        <div className="mt-6 max-w-[820px] space-y-5">
          {tab === "profile" && (
            <Panel title="Profile">
              <ProfileForm
                fullName={profile?.full_name ?? ""}
                handle={profile?.handle ?? ""}
                niche={profile?.niche ?? ""}
                email={user.email ?? ""}
              />
            </Panel>
          )}

          {tab === "account" && (
            <>
              <Panel title="Appearance">
                <p className="mb-3.5 text-[13.5px] leading-[1.5] text-ink-50">
                  applies to the app, on this device. the signed-out pages keep
                  their own design.
                </p>
                <ThemePicker current={theme} />
              </Panel>
            </>
          )}

          {tab === "account" && (
            <Panel
              title="Account"
              padded={false}
              footer={
                <form
                  action="/auth/sign-out"
                  method="post"
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"
                >
                  <p className="text-[13px] text-ink-50">
                    Ends this session on this device only.
                  </p>
                  <button
                    type="submit"
                    className="h-10 shrink-0 rounded-pill border border-line px-5 text-[14px] font-semibold text-ink-50 transition-colors hover:text-ink"
                  >
                    Sign out
                  </button>
                </form>
              }
            >
              <Fact label="Email" value={user.email ?? ""} />
              <Fact label="Sign-in method" value={provider} capitalize />
              <Fact
                label="Member since"
                value={since.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              />
              <Row>
                <span className="text-[14px] text-ink-50">Access</span>
                {/* what actually opened the door, not "Founder" for everyone. */}
                {isFounder ? (
                  <Pill tone="flame">Founder</Pill>
                ) : paid ? (
                  <Pill tone="flame">Paid plan</Pill>
                ) : memberships.some((m) => m.role === "owner") ? (
                  <Pill tone="quiet">Agency owner</Pill>
                ) : memberships.some((m) => m.role === "admin") ? (
                  <Pill tone="quiet">Agency admin</Pill>
                ) : memberships.length > 0 ? (
                  <Pill tone="quiet">Agency seat</Pill>
                ) : (
                  <Pill tone="quiet">No plan</Pill>
                )}
              </Row>
            </Panel>
          )}

          {tab === "account" && (
            <Panel title="Leave" padded={false}>
              <DeleteAccount email={user.email ?? "this account"} />
            </Panel>
          )}
        </div>
      </Page>
    </>
  );
}

/** Label on the left, the value on the right. The whole shape of both fact
 *  lists on this page, so they cannot drift apart. */
function Fact({
  label,
  value,
  capitalize = false,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <Row>
      <span className="shrink-0 text-[14px] text-ink-50">{label}</span>
      <span
        className={`min-w-0 truncate text-[14px] font-semibold ${
          capitalize ? "capitalize" : ""
        }`}
      >
        {value}
      </span>
    </Row>
  );
}
