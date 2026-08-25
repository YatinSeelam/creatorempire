import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { PersonAvatar } from "@/components/dash/thumb";
import { Empty, Panel, Pill, Row, Stat } from "@/components/dash/ui";
import { loadAgencies, personInitial, personName } from "@/lib/founder";
import { ago } from "@/lib/money";
import { tenantHost } from "@/lib/org";
import { customTools } from "@/lib/tools";

export const metadata: Metadata = {
  title: "Agencies · Founder · Creator Empire",
  robots: { index: false },
};

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Every workspace, from above. Who owns it, how many people sit on it and as
 * what, where its creators sign in, and whether a founder has put anything on
 * its shelf. Open one for the roster by name and the shelf itself.
 *
 * This is the founder role's view and nobody else has it: an agency's owner
 * sees their own workspace on /agency, an agency's admin the same one, and
 * neither can see the workspace next door.
 */
export default async function FounderAgenciesPage() {
  const [agencies, host] = await Promise.all([
    loadAgencies(),
    headers().then((h) => h.get("host")),
  ]);

  const seats = agencies.reduce((n, a) => n + a.people.length, 0);
  const granted = agencies.filter((a) => a.toolGrants.length > 0).length;
  const withDomain = agencies.filter((a) => a.org.custom_domain).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Workspaces"
          value={fmt(agencies.length)}
          note={agencies.length === 0 ? "nobody has made one yet" : "agencies and mentorships"}
        />
        <Stat
          label="Seats"
          value={fmt(seats)}
          note="owners, admins and creators, all together"
        />
        <Stat
          label="Custom tools"
          value={fmt(customTools.length)}
          note={
            customTools.length === 0
              ? "none built yet"
              : `on for ${fmt(granted)} ${granted === 1 ? "workspace" : "workspaces"}`
          }
        />
        <Stat
          label="Own domain"
          value={fmt(withDomain)}
          note="workspaces on a custom domain"
        />
      </div>

      <Panel title="Every workspace" padded={false}>
        {agencies.length === 0 ? (
          <Empty
            title="No workspaces yet."
            line="An owner makes one on /new, or you make one for them from their person page."
          />
        ) : (
          agencies.map((a) => {
            const owner = a.owner;
            return (
              <Row key={a.org.id}>
                <Link
                  href={`/founder/agencies/${a.org.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3 py-0.5"
                >
                  <OrgMark name={a.org.name} logo={a.org.logo_url} />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="truncate text-[15px] font-bold tracking-[-0.015em]">
                        {a.org.name}
                      </span>
                      {a.toolGrants.length > 0 && (
                        <Pill tone="flame">
                          {a.toolGrants.length} custom {a.toolGrants.length === 1 ? "tool" : "tools"}
                        </Pill>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[13.5px] text-ink-50">
                      {tenantHost(a.org, host)} · made {ago(a.created_at)}
                    </span>
                  </span>
                </Link>

                <div className="flex min-w-0 shrink-0 items-center gap-4 sm:gap-6">
                  {owner ? (
                    <Link
                      href={`/founder/people/${owner.user_id}`}
                      className="hidden min-w-0 items-center gap-2 text-right sm:flex"
                      title="the workspace's owner"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-semibold">
                          {personName(owner)}
                        </span>
                        <span className="block truncate text-[12.5px] text-ink-50">owner</span>
                      </span>
                      <PersonAvatar
                        src={owner.avatar_url}
                        initial={personInitial(owner)}
                        className="size-8"
                      />
                    </Link>
                  ) : (
                    <span className="hidden text-[12.5px] text-ink-50 sm:block">no owner row</span>
                  )}
                  <Cell value={fmt(a.counts.admins)} label={a.counts.admins === 1 ? "admin" : "admins"} />
                  <Cell value={fmt(a.counts.creators)} label={a.counts.creators === 1 ? "creator" : "creators"} />
                </div>
              </Row>
            );
          })
        )}
      </Panel>

      <p className="text-[13.5px] leading-[1.6] text-ink-50">
        A workspace&apos;s owner runs it on /agency and can name admins for it; an
        admin runs that one workspace and nothing else. What only a founder can
        do is on each workspace&apos;s page: switch a custom tool on for it, set
        up its creators&apos; public portfolios, or leave anything else on its shelf.
      </p>
    </div>
  );
}

function OrgMark({ name, logo }: { name: string; logo: string | null }) {
  return logo ? (
    // eslint-disable-next-line @next/next/no-img-element -- an arbitrary remote logo url
    <img
      src={logo}
      alt=""
      className="size-10 shrink-0 rounded-xl border border-line bg-paper object-contain p-1"
    />
  ) : (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ember text-[15px] font-bold text-flame">
      {name.charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function Cell({ value, label }: { value: string; label: string }) {
  return (
    <div className="w-[64px] shrink-0 text-right sm:w-[76px]">
      <p className="truncate text-[15px] font-bold tabular-nums">{value}</p>
      <p className="text-[12.5px] text-ink-50">{label}</p>
    </div>
  );
}
