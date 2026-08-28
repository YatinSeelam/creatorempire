import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Face } from "@/components/dash/face";
import { Field, Picker, Submit } from "@/components/dash/form";
import { CopyLink, RolePicker } from "@/components/dash/org-forms";
import { Page, Panel, Pill, Row } from "@/components/dash/ui";
import { shortDate } from "@/lib/money";
import { INVITE_ROLES, inviteLink, ROLE_LABEL, type OrgRole } from "@/lib/org";
import { loadInvites, loadMembers } from "@/lib/org-server";
import { requireAgency } from "@/lib/workspace";
import { cancelInvite, inviteMember, removeMember, setMemberRole } from "../actions";

export const metadata = { title: "Invites & roles · Creator Empire" };

/**
 * A seat and an offer of a seat are the same object at two moments, so they are
 * one list in one card rather than two cards that happen to look alike. The
 * second card was mostly chrome: a border, a heading and a gap for what is
 * usually a single row, which made a page holding two people read as three
 * separate screens stacked up.
 *
 * The prose went with it. Roles are explained once, live, under the picker that
 * sets them — a paragraph above the form and a note below it said the same
 * thing twice, and nobody reads either while they are typing an address.
 */
const ACTIONS = "flex min-w-[132px] shrink-0 items-center justify-end gap-2";

/** the face and the two lines beside it. `min-w-0` is what lets them truncate. */
const WHO = "flex min-w-0 flex-1 items-center gap-3";

/**
 * One line of the list: a face, a name over one quiet line, the role, and
 * whatever you can do about it pinned to the right edge.
 *
 * Shared by both halves so the pills sit in one column down the whole card. The
 * right slot keeps its width when it is empty, because a row with nothing to do
 * about it must not pull the column it shares out of line.
 */
function Seat({
  face,
  name,
  meta,
  role,
  actions,
}: {
  face: ReactNode;
  name: string;
  meta: ReactNode;
  role: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Row>
      <span className={WHO}>
        {face}
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-bold tracking-[-0.015em]">
            {name}
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-ink-50">
            {meta}
          </span>
        </span>
      </span>
      {role}
      <span className={ACTIONS}>{actions}</span>
    </Row>
  );
}

/** The strip that says the rows under it have not answered yet. */
function Group({ children }: { children: ReactNode }) {
  return (
    <div className="bg-shell/60 px-5 py-2 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50 sm:px-6">
      {children}
    </div>
  );
}

/**
 * The seats. Who holds one, who has been offered one, and taking one away.
 *
 * Deliberately has no money on it. That is /agency, one click away, and keeping
 * the two apart is what lets this page be the boring administrative screen it
 * should be: nobody wants to see a payout total while they are working out
 * whether they invited the right email address.
 *
 * An invite is an email plus a token and it is the only way in. There is no
 * join-by-slug, on purpose.
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
    <Page className="space-y-4">
      {note && (
        <p className="rounded-card border border-line bg-ember px-5 py-2.5 text-[13px] text-flame-dark">
          {note}
        </p>
      )}

      <Panel title="Invite" flush>
        {/* RolePicker draws the row and the live role note. The form itself
            stays a plain server action, so nothing about the page's reads or
            its redirect changes. */}
        <form action={inviteMember} className="mt-3">
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

      <Panel title={`People · ${members.length}`} padded={false}>
        {members.map((m) => (
          <Seat
            key={m.user_id}
            face={<Face name={m.name} src={m.avatar_url} />}
            name={m.name}
            meta={`${m.email ?? "no email on file"} · joined ${shortDate(m.joined_at)}`}
            role={
              m.role !== "owner" && agency.role === "owner" ? (
                <form action={setMemberRole} className="flex items-center gap-2">
                  <input type="hidden" name="org_id" value={agency.id} />
                  <input type="hidden" name="user_id" value={m.user_id} />
                  <Picker
                    name="role"
                    defaultValue={m.role}
                    ariaLabel="role"
                    options={INVITE_ROLES.map((r) => ({
                      value: r,
                      label: ROLE_LABEL[r],
                    }))}
                    triggerClass="flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-line bg-paper px-2 text-[13px] font-semibold focus:border-ink focus:outline-none"
                    chevronClass="size-3.5"
                  />
                  <Submit tone="ghost" size="xs">
                    Save
                  </Submit>
                </form>
              ) : (
                <Pill tone={m.role === "owner" ? "flame" : "quiet"}>
                  {ROLE_LABEL[m.role]}
                </Pill>
              )
            }
            actions={
              // the owner cannot be removed and an admin removes nobody: the
              // delete policy refuses both. The slot is left empty rather than
              // captioned, because a sentence explaining an absent button is
              // more words on screen than the button was.
              m.role !== "owner" && agency.role === "owner" ? (
                <form action={removeMember}>
                  <input type="hidden" name="org_id" value={agency.id} />
                  <input type="hidden" name="user_id" value={m.user_id} />
                  <Submit tone="ghost" size="xs">
                    Remove
                  </Submit>
                </form>
              ) : null
            }
          />
        ))}

        {invites.length > 0 && <Group>Invited · {invites.length}</Group>}

        {invites.map((i) => (
          <Seat
            key={i.id}
            // no avatar exists yet — there is no account behind an invite, only
            // an address — so the initial comes off the email and the ring is
            // dashed, which is the whole difference between the two halves at
            // a glance.
            face={
              <Face
                name={i.email}
                src={null}
                className="size-9 border border-dashed border-line"
              />
            }
            name={i.email}
            meta={
              i.expired ? (
                <span className="text-flame-dark">
                  link expired {shortDate(i.expires_at)}
                </span>
              ) : (
                `expires ${shortDate(i.expires_at)}`
              )
            }
            role={<Pill tone="line">{ROLE_LABEL[i.role as OrgRole]}</Pill>}
            actions={
              <>
                {/* a link past its date is dead: `accept_org_invite` refuses
                    it. The row stays so it can be cancelled, but the copy
                    button goes, because handing somebody a link that says
                    "expired" on arrival is worse than sending a fresh one. */}
                {!i.expired && (
                  <CopyLink href={inviteLink(agency.org, i.token, host)} />
                )}
                <form action={cancelInvite}>
                  <input type="hidden" name="invite_id" value={i.id} />
                  <Submit tone="ghost" size="xs">
                    Cancel
                  </Submit>
                </form>
              </>
            }
          />
        ))}
      </Panel>
    </Page>
  );
}
