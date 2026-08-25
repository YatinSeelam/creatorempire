import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { toApplication, toEditor } from "@/components/editors/coerce";
import {
  PayoutDetailsForm,
  StripeConnectPanel,
} from "@/components/editors/payout-form";
import { ProfileEditor } from "@/components/editors/profile-editor";
import { Panel, QuietLink } from "@/components/editors/ui";
import { toSettingsTab } from "@/lib/editing";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Settings · Creator Empire",
  robots: { index: false, follow: false },
};

/**
 * One page for everything about the person, rather than three.
 *
 * It used to be spread across the desk (a read-only "your info" block), the
 * apply form (the same fields, editable) and /editors/profile (the public
 * page). Three places answering "where do I change my name" is two too many,
 * so the desk's copy is gone, /editors/profile redirects here, and the profile
 * editor is hosted inside this page as its body.
 *
 * One page, four tabs, one section at a time. This page hands ProfileEditor the
 * blocks it cannot render itself (anything that needs the server: the auth
 * account, the application answers, the payout rails) and ProfileEditor decides
 * which tab each one belongs to. There is still exactly one save button,
 * because underneath all of it there is one `editors` row.
 *
 * The photo is a picker, not a url box. Asking somebody to go and host a square
 * image somewhere and paste the link is the reason none of the first thirteen
 * editors had one.
 */
export default async function EditorSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const tab = toSettingsTab((await searchParams).tab);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/editors/settings");

  const [
    { data: editorRow },
    { data: applicationRow },
    { data: payoutDetails },
    { data: stripeRow },
  ] = await Promise.all([
    supabase.from("editors").select("*").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("editor_applications")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("editor_payout_details")
      .select("method, address")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("editor_stripe_accounts")
      .select("details_submitted, payouts_enabled, disabled_reason, requirements_due")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  // no editor row means the join flow on the desk never ran, and that is the
  // only screen that can create one.
  if (!editorRow) redirect("/editors");

  const application = applicationRow
    ? toApplication(applicationRow as Record<string, unknown>)
    : null;

  // how they signed in. worth printing because it is the answer to "why does
  // my password not work" — there is no password on a google account.
  const provider = user.app_metadata?.provider ?? "email";

  // read-only here on purpose. these are application answers and the apply
  // form owns them; a second editable copy is a second thing to keep in step
  // and a second answer to "where do i change my phone number".
  const contactRows: [string, string | null][] = application
    ? [
        ["phone", application.phone],
        ["discord", application.discord],
        ["country", application.country],
        ["time zone", application.timezone],
        ["languages", application.languages],
      ]
    : [];

  const capacityRows: [string, string | null][] = application
    ? [
        [
          "videos a day",
          application.videos_per_day != null
            ? String(application.videos_per_day)
            : null,
        ],
        [
          "hours a week",
          application.hours_per_week != null
            ? String(application.hours_per_week)
            : null,
        ],
        ["weekends", application.weekends ? "yes" : "no"],
      ]
    : [];

  const account = (
    <Panel title="account">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Field label="signed in as" value={user.email ?? "not on file"} />
        <Field
          label="sign-in method"
          value={provider === "google" ? "google" : "email link"}
        />
      </dl>
      {/* a form, not a link. signing out changes state, and a GET that changes
          state gets fired by every link prefetcher there is. */}
      <form action="/auth/sign-out" method="post" className="mt-5">
        <button
          type="submit"
          className="rounded-pill border border-line px-4 py-2 text-[13.5px] font-semibold text-ink-70 transition-colors hover:border-flame hover:text-flame-dark"
        >
          sign out
        </button>
      </form>
    </Panel>
  );

  const contact = (
    <Panel
      title="how we reach you"
      action={<QuietLink href="/editors/apply">edit</QuietLink>}
    >
      <Facts rows={contactRows} />
    </Panel>
  );

  const capacity = (
    <Panel
      title="what you can take on"
      action={<QuietLink href="/editors/apply">edit</QuietLink>}
    >
      <Facts rows={capacityRows} />
    </Panel>
  );

  const payments = (
    <div>
      <Panel
        title="getting paid"
        action={<QuietLink href="/editors/payouts">open payouts</QuietLink>}
      >
        <PayoutDetailsForm
          initial={
            payoutDetails
              ? {
                  method: String(payoutDetails.method),
                  address: String(payoutDetails.address),
                }
              : null
          }
        />
        {/* only for the rail that needs setting up. showing a connect button
            to somebody on paypal is a step they do not have to take. */}
        {String(payoutDetails?.method ?? "paypal") === "stripe" && (
          <div className="mt-5 border-t border-line pt-5">
            <StripeConnectPanel
              status={{
                connected: Boolean(stripeRow),
                detailsSubmitted: stripeRow?.details_submitted === true,
                payoutsEnabled: stripeRow?.payouts_enabled === true,
                disabledReason:
                  (stripeRow?.disabled_reason as string | null) ?? null,
                requirementsDue: Array.isArray(stripeRow?.requirements_due)
                  ? stripeRow.requirements_due.length
                  : 0,
              }}
            />
          </div>
        )}
      </Panel>
    </div>
  );

  return (
    <ProfileEditor
      initial={toEditor(editorRow as Record<string, unknown>)}
      title="settings"
      initialTab={tab}
      account={account}
      contact={contact}
      capacity={capacity}
      payments={payments}
    />
  );
}

/** A read-only block, or an honest line about why it is empty. */
function Facts({ rows }: { rows: [string, string | null][] }) {
  const filled = rows.filter(([, v]) => v);

  if (filled.length === 0) {
    return (
      <p className="text-[14px] text-ink-50">
        nothing on file yet.{" "}
        <Link
          href="/editors/apply"
          className="font-semibold text-flame transition-colors hover:text-flame-dark"
        >
          fill this in
        </Link>{" "}
        so we know what to send you.
      </p>
    );
  }

  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {filled.map(([label, value]) => (
        <Field key={label} label={label} value={value as string} />
      ))}
    </dl>
  );
}

/** Label over value, the read-only twin of the profile editor's Input. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-50">
        {label}
      </dt>
      <dd className="mt-1 truncate text-[14.5px] font-semibold">{value}</dd>
    </div>
  );
}
