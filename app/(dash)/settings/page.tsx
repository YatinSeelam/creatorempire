import { cookies } from "next/headers";
import { DashBar, Page, Panel, Pill, Row, barTitle } from "@/components/dash/ui";
import { DeleteAccount, ProfileForm } from "@/components/dash/settings-controls";
import { ThemePicker } from "@/components/dash/theme-picker";
import { requireViewer } from "@/lib/access";
import { readTheme, THEME_COOKIE } from "@/lib/theme";
import { BASE_PATH } from "@/lib/base-path";

export const metadata = { title: "Settings · Creator Empire" };

// access state is per-request and must never come out of a cache.
export const dynamic = "force-dynamic";

/**
 * One page, four panels, no tabs.
 *
 * The tab strip was inherited from ugc flows, where it splits Profile,
 * Sections, Billing and Account into four screens' worth of forms. Here two of
 * those four do not exist: there is no plan to buy and no rail to rearrange.
 * That left a row of pills switching between one form and three short fact
 * lists, and it hid the one control people actually come looking for, the
 * theme, behind a tab called Account that gives no hint it is in there.
 *
 * So: everything on one screen, in the order somebody scans it. Who you are,
 * what the app looks like, what the account is, and the way out.
 */
export default async function SettingsPage() {
  const [{ supabase, user, isFounder, memberships }, jar] = await Promise.all([
    requireViewer("/settings"),
    cookies(),
  ]);

  const theme = readTheme(jar.get(THEME_COOKIE)?.value);
  const seatRole = memberships[0]?.role ?? null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, handle, niche, created_at")
    .eq("id", user.id)
    .single();

  // The API panel is gone from this page, deliberately, 2026-08-28.
  //
  // The keys this deploy spends money through are the deploy's own and live in
  // its env. `apiKey()` in lib/api-keys.ts still reads a stored workspace key
  // first, so the whole per-programme path is intact and unbroken — what is
  // removed is only the form. Asking somebody who runs a mentorship to go and
  // buy a scrapecreators plan is a worse first day than it sounds, and a panel
  // of empty password fields on the settings screen reads as work the product
  // is waiting on them for. Nothing is: with no row stored, every provider
  // falls through to the env and the app works.
  //
  // To hand a programme its own keys again, render `ApiKeysForm` here behind
  // `seatRole === "owner" || seatRole === "admin"` and read `provider, hint`
  // off `org_api_credentials`; the component, the two actions and the rpcs are
  // all still there.

  // how they signed in. google fills this, an email signup says "email".
  const provider = (user.app_metadata?.provider as string | undefined) ?? "email";
  const since = new Date(profile?.created_at ?? user.created_at);
  const seat = seatRole;

  return (
    <>
      <DashBar lead={<h1 className={barTitle}>Settings</h1>} />

      {/* one column. these are forms and fact lists, and neither reads at
          1600px wide on the monitor the shell allows for. */}
      <Page className="max-w-[820px] space-y-5">
        <Panel title="Profile">
          <ProfileForm
            fullName={profile?.full_name ?? ""}
            handle={profile?.handle ?? ""}
            niche={profile?.niche ?? ""}
            email={user.email ?? ""}
          />
        </Panel>

        <Panel title="Appearance" sub="this device only. it does not follow you to another one.">
          <ThemePicker current={theme} />
        </Panel>

        <Panel
          title="Account"
          padded={false}
          footer={
            <form
              action={`${BASE_PATH}/auth/sign-out`}
              method="post"
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"
            >
              <p className="text-[13px] text-ink-50">
                ends this session on this device only.
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
          <Fact label="Signed in with" value={provider} capitalize />
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
            {/* what actually opened the door, not "founder" for everyone. */}
            {isFounder ? (
              <Pill tone="flame">Founder</Pill>
            ) : seat === "owner" || seat === "admin" ? (
              <Pill tone="quiet">Runs the programme</Pill>
            ) : seat ? (
              <Pill tone="quiet">Student</Pill>
            ) : (
              <Pill tone="quiet">No access</Pill>
            )}
          </Row>
        </Panel>

        <Panel title="Leave" padded={false}>
          <DeleteAccount email={user.email ?? "this account"} />
        </Panel>
      </Page>
    </>
  );
}

/** Label on the left, the value on the right. The whole shape of the fact list,
 *  so its rows cannot drift apart. */
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
