import type { Metadata } from "next";
import Link from "next/link";
import { acceptInvite } from "@/app/(dash)/agency/actions";
import { Mark } from "@/components/art";
import { Submit } from "@/components/dash/form";
import { ROLE_NOTE, themeVars, type OrgRole } from "@/lib/org";
import { loadBrand } from "@/lib/org-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Join · Creator Empire",
  robots: { index: false },
};

/**
 * Accepting an invite, outside the member gate on purpose.
 *
 * This page used to live under (dash), whose layout requires a subscription, a
 * seat or admin. A fresh invitee has none of those until the moment they
 * accept, so every invite link bounced them to the pricing screen. The proxy
 * still requires a login (and round-trips back here through ?next=), but no
 * membership is asked for: the invite IS the membership, one button from now.
 *
 * It is not accepted on load. A GET that joins you to somebody's workspace is
 * joinable by anything that follows a link. `peek_org_invite` only reads, and
 * `accept_org_invite` still checks the token against the signed-in email, so a
 * forwarded link seats nobody.
 */
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ note?: string }>;
}) {
  // invite links are minted on the agency's own address, so the page that
  // opens them wears the agency's logo and accent rather than ours.
  const [{ token }, { note }, tenant] = await Promise.all([
    params,
    searchParams,
    loadBrand(),
  ]);

  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    { data: peeked },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("peek_org_invite", { p_token: token }),
  ]);

  const invite = Array.isArray(peeked) ? (peeked[0] ?? null) : (peeked ?? null);
  const role = (invite?.invite_role ?? "creator") as OrgRole;

  return (
    <main
      className="flex min-h-dvh items-center justify-center bg-shell px-4 py-10"
      style={themeVars(tenant)}
    >
      <div className="w-full max-w-[460px]">
        <div className="mb-5 flex items-center gap-2.5 font-extrabold text-[19px] tracking-[-0.02em]">
          {tenant?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tenant.logo_url}
              alt=""
              className="size-7 rounded-[9px] object-cover"
            />
          ) : (
            <Mark className="size-7 rounded-[9px]" />
          )}
          {tenant?.name ?? "creator empire"}
        </div>

        {note && (
          <p className="mb-4 rounded-card border border-line bg-ember px-5 py-3.5 text-[13.5px] text-flame-dark">
            {note}
          </p>
        )}

        <div className="rounded-[18px] border border-line bg-paper p-7">
          {!invite ? (
            <>
              <h1 className="text-[19px] font-bold tracking-[-0.015em]">
                This invite link is not one we know.
              </h1>
              <p className="mt-2 text-[13.5px] leading-[1.6] text-ink-50">
                It may have been mistyped or cancelled. Ask whoever sent it for
                a fresh link.
              </p>
            </>
          ) : !invite.valid ? (
            <>
              <h1 className="text-[19px] font-bold tracking-[-0.015em]">
                This invite has expired or was already used.
              </h1>
              <p className="mt-2 text-[13.5px] leading-[1.6] text-ink-50">
                Invites stop working after a while on purpose. Ask{" "}
                {invite.org_name} to send you a new one.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-[19px] font-bold tracking-[-0.015em]">
                Join {invite.org_name}
              </h1>
              <p className="mt-2 text-[13.5px] leading-[1.6] text-ink-50">
                You were invited as {role}. {ROLE_NOTE[role]} Your own deals
                stay on your own account; the ones you do for them count on
                their books, and leaving hands those back to you.
              </p>
              <p className="mt-3 text-[12.5px] leading-[1.6] text-ink-50">
                The invite was sent to {invite.email_masked}
                {user?.email ? (
                  <>
                    {" "}
                    and you are signed in as {user.email}. If those are not the
                    same inbox, the join below will say so.
                  </>
                ) : (
                  "."
                )}
              </p>

              {/* the wrong-account case is the common one: a creator signs
                  in with the google account they use for everything and the
                  invite went to their business address. the join refuses,
                  correctly, and without this the only way out was a sign-out
                  somewhere else and finding the link again. `next` brings the
                  right account straight back here. */}
              {user?.email && (
                <form
                  action={`/auth/sign-out?next=${encodeURIComponent(`/join/${token}`)}`}
                  method="post"
                  className="mt-2"
                >
                  <button
                    type="submit"
                    className="text-[12.5px] font-semibold text-ink-70 underline underline-offset-4 hover:text-flame"
                  >
                    Not you? Sign out and come back as the invited email.
                  </button>
                </form>
              )}

              <form
                action={async () => {
                  "use server";
                  await acceptInvite(token);
                }}
                className="mt-5"
              >
                <Submit pendingLabel="Joining">Join the workspace</Submit>
              </form>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-[12.5px] text-ink-50">
          <Link href="/dashboard" className="hover:text-flame">
            back to your dashboard
          </Link>
        </p>
      </div>
    </main>
  );
}
