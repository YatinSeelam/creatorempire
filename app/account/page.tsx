import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountNav } from "@/components/account-nav";
import { isEntitled, loadAccess } from "@/lib/access";
import { claimPendingInvite } from "@/lib/invite-claim";
import { CE_ORG_ID } from "@/lib/org";
import { BASE_PATH } from "@/lib/base-path";

export const metadata: Metadata = {
  title: "Your account · Creator Empire",
  robots: { index: false },
};

// entitlement is per request and must never come out of a cache
export const dynamic = "force-dynamic";

/**
 * Where the gate sends somebody it turned away.
 *
 * there is nothing to sell here: a seat on creator empire is handed out by the
 * programme, so the only honest thing this page can say is "your google
 * account is not on the roster yet" and who to ask. anybody the gate would
 * let in is sent straight back to the dashboard, so this page and
 * `requireViewer()` can never bounce each other.
 */
export default async function AccountPage() {
  const access = await loadAccess();
  if (!access) redirect("/login?next=/dashboard");
  if (isEntitled(access)) redirect("/dashboard");

  // somebody parked on this page while an admin added them. a reload is the
  // obvious thing to try, so a reload is what collects the seat, rather than
  // the sign out and back in the copy below used to ask for.
  if (await claimPendingInvite(access.supabase)) redirect("/dashboard");

  const email = access.user.email ?? "";
  const unsure = access.readFailed;
  const unconfigured = !CE_ORG_ID;

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="grid-paper grid-paper-fade pointer-events-none absolute inset-0" />
      <div className="relative">
        <AccountNav showDashboard={false} />
        <main className="mx-auto w-full max-w-[560px] px-5 pb-16 pt-6 sm:px-6 sm:pt-10">
          <div className="rounded-card border border-line bg-paper p-6 sm:p-8">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-50">
              signed in as
            </p>
            <p className="mt-1 break-all text-[15px] font-semibold">{email}</p>

            <h1 className="mt-6 text-[clamp(1.5rem,6vw,1.9rem)] font-extrabold leading-[1.15] tracking-[-0.025em]">
              {unsure
                ? "we could not read your seat"
                : unconfigured
                  ? "this deploy has no workspace yet"
                  : "you are not on the roster yet"}
            </h1>
            <p className="mt-3 text-[15px] leading-[1.6] text-ink-50">
              {unsure
                ? "a read failed on our side. try again in a moment, nothing about your account changed."
                : unconfigured
                  ? "set NEXT_PUBLIC_CE_ORG_ID to the creator empire org id and redeploy. only a founder gets in until then."
                  : "ask your creator empire admin to add this google email to the programme. once they do, reload this page and the dashboard opens."}
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              {unsure && (
                <a
                  href={`${BASE_PATH}/dashboard`}
                  className="inline-flex h-[44px] items-center rounded-pill bg-flame px-6 text-[14px] font-semibold text-on-accent hover:bg-flame-dark"
                >
                  try again
                </a>
              )}
              <form action={`${BASE_PATH}/auth/sign-out`} method="post">
                <button
                  type="submit"
                  className="inline-flex h-[44px] items-center rounded-pill border border-line px-6 text-[14px] font-semibold hover:bg-shell"
                >
                  use a different google account
                </button>
              </form>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
