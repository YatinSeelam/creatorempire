import { headers } from "next/headers";
import { Face } from "@/components/dash/face";
import { Field, Submit } from "@/components/dash/form";
import { CopyLink, RolePicker } from "@/components/dash/org-forms";
import { Page, Panel, Pill, Row } from "@/components/dash/ui";
import { shortDate } from "@/lib/money";
import { INVITE_ROLES, inviteLink, ROLE_LABEL, type OrgRole } from "@/lib/org";
import { loadInvites, loadMembers } from "@/lib/org-server";
import { requireAgency } from "@/lib/workspace";
import { cancelInvite, inviteMember, removeMember, setMemberRole } from "../actions";

export const metadata = { title: "Invites & roles · Creator Empire" };

/**
 * The two lists on this page describe the same thing at two different moments:
 * an email that has been offered a seat, and a person who took one. So they are
 * drawn as one row shape with the pieces in the same places — a face, a name
 * over one quiet line, the role as a pill, and whatever you can do about it
 * pinned to the right edge. They used to be laid out differently for no reason
 * anybody could name, which made the second panel read as a different kind of
 * object rather than as the next stage of the first.
 *
 * The right-hand column is a shared minimum width rather than a number picked
 * per list. It is sized by the widest cluster either list carries, which is the
 * invite's Copy link plus Cancel, and sharing it is what lines the role pills up
 * down BOTH panels: they sit one above the other on screen, so a column that
 * only agreed with itself would read as a wobble between the two. `min-w` rather
 * than a fixed `w` because a longer button label should push the column out
 * rather than spill out of it, which is exactly what the old hand-measured
 * `w-[84px]` on the roster could not do.
 */
const ACTIONS = "flex min-w-[150px] shrink-0 items-center justify-end gap-2";

/** the face and the two lines beside it. `min-w-0` is what lets them truncate. */
const WHO = "flex min-w-0 flex-1 items-center gap-3";

/**
 * The seats. Who holds one, who has been offered one, and taking one away.
 *
 * Deliberately has no money on it. That is /agency, one click away, and keeping
 * the two apart is what lets this page be the boring administrative screen it
 * should be: nobody wants to see a payout total while they are working out
 * whether they invited the right email address.
 *
 * An invite is an email plus a token and it is the only way in. There is no
 * join-by-slug, on purpose, and the roles are described where they are picked
 * rather than in documentation nobody opens.
 */
export default async function AgencyPeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string }>;
}) {
  const [{ note }, agency] = await Promise.all([searchParams, requireAgency()]);

  const [members, invites, host] = await Promise.all([
    loadMembers(agency.id),
    loadInvites(agency.id),
    headers().then((h) => h.get("host")),
  ]);

  return (
    <Page className="space-y-5">
      {note && (
        <p className="rounded-card border border-line bg-ember px-5 py-3.5 text-[13.5px] text-flame-dark">
          {note}
        </p>
      )}

      <Panel title="Invite a student or an admin" flush>
        <p className="mt-1 max-w-[64ch] text-[13.5px] leading-[1.6] text-ink-50">
          A student keeps their own login. Only the deals they do inside the
          programme land on these books. An admin runs the programme: invites,
          roles and the numbers, and touches no deal.
        </p>

        {/* RolePicker draws the row and the live role note. The form itself
            stays a plain server action, so nothing about the page's reads or
            its redirect changes. */}
        <form action={inviteMember} className="mt-5">
          <input type="hidden" name="org_id" value={agency.id} />
          <RolePicker
            field={
              <Field
                label="Email"
                name="email"
                placeholder="creator@example.com"
                required
              />
            }
            submit={<Submit>Create invite</Submit>}
          />
        </form>
      </Panel>

      {invites.length > 0 && (
        <Panel title={`Waiting on a reply · ${invites.length}`} padded={false}>
          {invites.map((i) => {
            // a link past its date is dead: `accept_org_invite` refuses it. it
            // stays listed so it can be cancelled, but the copy button goes,
            // because handing somebody a link that says "expired" on arrival
            // is worse than telling the owner to send a fresh one.
            const expired = i.expired;
            return (
              <Row key={i.id}>
                <span className={WHO}>
                  {/* no avatar exists yet — there is no account behind an invite,
                    only an address — so the initial comes off the email. The
                    mark is here at all because dropping it would knock this
                    list's text out of line with the roster's directly below. */}
                  <Face name={i.email} src={null} />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-bold tracking-[-0.015em]">
                      {i.email}
                    </span>
                    <span
                      className={`mt-0.5 block truncate text-[12.5px] ${expired ? "text-flame-dark" : "text-ink-50"}`}
                    >
                      {expired
                        ? `expired ${shortDate(i.expires_at)}. invite them again for a fresh link.`
                        : `expires ${shortDate(i.expires_at)}`}
                    </span>
                  </span>
                </span>

                <Pill tone="quiet">{ROLE_LABEL[i.role as OrgRole]}</Pill>

                <span className={ACTIONS}>
                  {!expired && (
                    <CopyLink href={inviteLink(agency.org, i.token, host)} />
                  )}
                  <form action={cancelInvite}>
                    <input type="hidden" name="invite_id" value={i.id} />
                    <Submit tone="ghost" size="xs">
                      Cancel
                    </Submit>
                  </form>
                </span>
              </Row>
            );
          })}
        </Panel>
      )}

      <Panel title={`In the programme · ${members.length}`} padded={false}>
        {members.map((m) => (
          <Row key={m.user_id}>
            <span className={WHO}>
              <Face name={m.name} src={m.avatar_url} />
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-bold tracking-[-0.015em]">
                  {m.name}
                </span>
                <span className="mt-0.5 block truncate text-[12.5px] text-ink-50">
                  {m.email ?? "no email on file"} · joined{" "}
                  {shortDate(m.joined_at)}
                </span>
              </span>
            </span>

            {m.role !== "owner" && agency.role === "owner" ? (
              <form action={setMemberRole} className="flex items-center gap-2">
                <input type="hidden" name="org_id" value={agency.id} />
                <input type="hidden" name="user_id" value={m.user_id} />
                <select
                  name="role"
                  defaultValue={m.role}
                  aria-label="role"
                  className="h-8 rounded-[8px] border border-line bg-paper px-2 text-[13px] font-semibold"
                >
                  {INVITE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                <Submit tone="ghost" size="xs">
                  Save
                </Submit>
              </form>
            ) : (
              <Pill tone="quiet">{ROLE_LABEL[m.role]}</Pill>
            )}

            <span className={ACTIONS}>
              {m.role === "owner" ? (
                // the slot says why there is no button rather than sitting
                // empty, which would read as a control that failed to render.
                // It no longer repeats the word "owner" at it: the pill two
                // inches to the left already said that.
                <span className="text-[12.5px] text-ink-50">
                  cannot be removed
                </span>
              ) : agency.role !== "owner" ? (
                // an admin reads the roster and changes none of it. the delete
                // policy refuses them anyway; drawing the button was a promise
                // the database was going to break.
                <span className="text-[12.5px] text-ink-50">owner removes</span>
              ) : (
                <form action={removeMember}>
                  <input type="hidden" name="org_id" value={agency.id} />
                  <input type="hidden" name="user_id" value={m.user_id} />
                  <Submit tone="ghost" size="xs">
                    Remove
                  </Submit>
                </form>
              )}
            </span>
          </Row>
        ))}
      </Panel>
    </Page>
  );
}
