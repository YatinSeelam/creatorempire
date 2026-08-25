import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Field, Submit } from "@/components/dash/form";
import { PersonAvatar } from "@/components/dash/thumb";
import { Empty, Panel, Pill, Row } from "@/components/dash/ui";
import { ViewAsButton } from "@/components/dash/view-as";
import { loadAgency, personInitial, personName } from "@/lib/founder";
import { ago } from "@/lib/money";
import {
  featureOn,
  ORG_FEATURES,
  ROLE_LABEL,
  ROLE_NOTE,
  tenantHost,
  tenantUrl,
  toolFeatureKey,
} from "@/lib/org";
import {
  asPortfolioBadge,
  asPortfolioFooter,
  isGranted,
  isKnownKey,
  overrideValue,
  PORTFOLIO_BADGE_KEY,
  PORTFOLIO_FOOTER_KEY,
  toolKey,
} from "@/lib/org-overrides";
import { customTools, tools, type ToolCard } from "@/lib/tools";
import {
  deleteOverride,
  grantTool,
  revokeTool,
  savePortfolioSetup,
  setOverride,
} from "../actions";

export const metadata: Metadata = {
  title: "Workspace · Founder · Creator Empire",
  robots: { index: false },
};

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/**
 * One workspace, from above: who owns it, who sits on it, and the founder
 * shelf. The roster half is read only, on purpose. Seats are the owner's to
 * hand out and take back (and the owner's own seat is pinned by trigger), and
 * a founder who wants to act inside the workspace has "view as" on the owner,
 * which is a real session swap rather than a wider write.
 *
 * The shelf is the half only a founder has: custom tools switched on for this
 * workspace, the setup its creators' public portfolios pick up, and a raw
 * key/value list for whatever gets built for them next.
 */
export default async function FounderAgencyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ note?: string }>;
}) {
  const [{ id }, { note }, host] = await Promise.all([
    params,
    searchParams,
    headers().then((h) => h.get("host")),
  ]);

  const agency = await loadAgency(id);
  if (!agency) notFound();

  const { org, owner, people, invites, overrides, created_at } = agency;
  const address = tenantHost(org, host);

  const footer = asPortfolioFooter(overrideValue(overrides, PORTFOLIO_FOOTER_KEY));
  const badge = asPortfolioBadge(overrideValue(overrides, PORTFOLIO_BADGE_KEY));
  const other = overrides.filter((o) => !isKnownKey(o.key));
  // grants for tools no longer in the registry: still rows, still worth seeing,
  // because a founder cleaning up should be able to remove them.
  // widened from the `as const` tuple: an empty registry is `never[]` to tsc,
  // and every property read on it fails; as a plain list it simply maps to nothing.
  const registry: readonly ToolCard[] = customTools;
  const staleGrants = agency.toolGrants.filter(
    (slug) => !registry.some((t) => t.slug === slug)
  );

  return (
    <div className="space-y-6">
      <Link
        href="/founder/agencies"
        className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-ink-50 transition-colors hover:text-flame"
      >
        <span aria-hidden="true">←</span> Every workspace
      </Link>

      {note && (
        <p className="rounded-card border border-line bg-ember px-5 py-3.5 text-[13.5px] text-flame-dark">
          {note}
        </p>
      )}

      {/* 1. what it is and whose it is */}
      <Panel>
        <div className="flex flex-wrap items-start gap-5">
          {org.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- an arbitrary remote logo url
            <img
              src={org.logo_url}
              alt=""
              className="size-16 shrink-0 rounded-2xl border border-line bg-paper object-contain p-1.5"
            />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-ember text-[22px] font-bold text-flame">
              {org.name.charAt(0).toUpperCase() || "?"}
            </span>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h2 className="text-[20px] font-bold tracking-[-0.02em]">{org.name}</h2>
              {org.custom_domain && <Pill tone="quiet">own domain</Pill>}
              {org.flow_key_set_at && <Pill tone="quiet">own flow key</Pill>}
            </div>
            <p className="mt-1 text-[13.5px] text-ink-50">
              <a
                href={tenantUrl(org, host)}
                target="_blank"
                rel="noreferrer"
                className="transition-colors hover:text-flame"
              >
                {address}
              </a>
              {" · "}
              slug <span className="font-mono text-[12.5px]">{org.slug}</span>
              {" · "}made {when(created_at)} ({ago(created_at)})
            </p>
            <p className="mt-1 text-[13.5px] text-ink-50">
              {agency.counts.owners} owner, {agency.counts.admins}{" "}
              {agency.counts.admins === 1 ? "admin" : "admins"}, {agency.counts.creators}{" "}
              {agency.counts.creators === 1 ? "creator" : "creators"}
              {invites.length > 0 &&
                ` · ${invites.length} ${invites.length === 1 ? "invite" : "invites"} waiting`}
            </p>
          </div>

          {owner && (
            <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-shell px-4 py-3 sm:w-auto sm:min-w-[300px]">
              <Link
                href={`/founder/people/${owner.user_id}`}
                className="flex min-w-0 items-center gap-3"
              >
                <PersonAvatar
                  src={owner.avatar_url}
                  initial={personInitial(owner)}
                  className="size-10"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-bold tracking-[-0.01em]">
                    {personName(owner)}
                  </span>
                  <span className="block truncate text-[12.5px] text-ink-50">
                    owner · {owner.email ?? "no email"}
                  </span>
                </span>
              </Link>
              <ViewAsButton userId={owner.user_id} name={personName(owner)} />
            </div>
          )}
        </div>
      </Panel>

      {/* 2. the roster, by role. read only here: seats are the owner's to give. */}
      <Panel
        title="People"
        sub="who sits on this workspace and as what. the owner hands seats out on /agency/people; an admin runs this workspace only."
        padded={false}
      >
        {people.length === 0 ? (
          <Empty title="Nobody is seated." line="Not even an owner row, which the orgs trigger should have written." />
        ) : (
          people.map((p) => (
            <Row key={p.user_id}>
              <Link
                href={`/founder/people/${p.user_id}`}
                className="flex min-w-0 flex-1 items-center gap-3 py-0.5"
              >
                <PersonAvatar
                  src={p.avatar_url}
                  initial={personInitial(p)}
                  className="size-9"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-semibold tracking-[-0.01em]">
                    {personName(p)}
                  </span>
                  <span className="block truncate text-[12.5px] text-ink-50">
                    {p.email ?? "no email"} · joined {ago(p.joined_at)}
                  </span>
                </span>
              </Link>
              <span title={ROLE_NOTE[p.role]}>
                <Pill tone={p.role === "owner" ? "flame" : "quiet"}>{ROLE_LABEL[p.role]}</Pill>
              </span>
            </Row>
          ))
        )}

        {invites.length > 0 && (
          <div className="border-t border-line px-5 py-4 sm:px-6">
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.12em] text-ink-50">
              Waiting on
            </p>
            <ul className="mt-2 space-y-1.5">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
                  <span className="min-w-0 truncate">{i.email}</span>
                  <Pill tone="quiet">{ROLE_LABEL[i.role]}</Pill>
                  <span className="text-ink-50">
                    {i.expired ? "expired" : `expires ${when(i.expires_at)}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      {/* 3. tools: what the owner switched off, and what only a founder can switch on */}
      <Panel
        title="Tools"
        sub="the standard shelf is the owner's to tidy on their branding page. custom tools are yours to grant, per workspace, and nobody else's."
        padded={false}
      >
        <div className="px-5 py-4 sm:px-6">
          <p className="text-[12.5px] font-semibold uppercase tracking-[0.12em] text-ink-50">
            Standard shelf, as the owner set it
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {tools.map((t) => {
              const on = featureOn(org.features, toolFeatureKey(t.slug));
              return (
                <li key={t.slug}>
                  <Pill tone="quiet">
                    <span className={on ? "" : "line-through opacity-60"}>{t.name}</span>
                  </Pill>
                </li>
              );
            })}
            {!featureOn(org.features, "nav.tools") && (
              <li>
                <Pill tone="flame">whole shelf hidden</Pill>
              </li>
            )}
          </ul>
          <p className="mt-2 text-[12.5px] text-ink-50">
            {ORG_FEATURES.filter((f) => f.group === "tool" && !featureOn(org.features, f.key)).length === 0
              ? "every standard tool is showing for their roster."
              : "struck through means the owner hid it. that hides the card only; the page still answers for anyone who bookmarked it."}
          </p>
        </div>

        <div className="border-t border-line">
          <div className="px-5 pt-4 sm:px-6">
            <p className="text-[12.5px] font-semibold uppercase tracking-[0.12em] text-ink-50">
              Custom tools, on for this workspace only
            </p>
          </div>

          {registry.length === 0 && staleGrants.length === 0 ? (
            <div className="px-5 py-5 sm:px-6">
              <p className="text-[14.5px] font-semibold">None built yet.</p>
              <p className="mt-1 max-w-[70ch] text-[13.5px] leading-[1.6] text-ink-50">
                A custom tool is a page under <code className="font-mono text-[12.5px]">app/(dash)/tools/&lt;slug&gt;/</code>{" "}
                that opens with <code className="font-mono text-[12.5px]">requireCustomTool(&quot;&lt;slug&gt;&quot;)</code>,
                an entry in <code className="font-mono text-[12.5px]">customTools</code> in{" "}
                <code className="font-mono text-[12.5px]">lib/tools.ts</code>, and a glyph. Once it is
                registered, a switch for it appears right here, and only the workspaces you switch it
                on for ever see the card or reach the page.
              </p>
            </div>
          ) : (
            <>
              {registry.map((t) => {
                const on = isGranted(overrideValue(overrides, toolKey(t.slug)));
                return (
                  <Row key={t.slug}>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="text-[14.5px] font-semibold tracking-[-0.01em]">{t.name}</span>
                        <Pill tone={on ? "flame" : "quiet"}>{on ? "on" : "off"}</Pill>
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-ink-50">
                        {t.blurb} · <span className="font-mono">{t.href}</span>
                      </p>
                    </div>
                    <form action={on ? revokeTool : grantTool}>
                      <input type="hidden" name="org_id" value={org.id} />
                      <input type="hidden" name="slug" value={t.slug} />
                      <Submit tone={on ? "line" : "flame"} size="sm" pendingLabel="Saving">
                        {on ? "Switch off" : "Switch on"}
                      </Submit>
                    </form>
                  </Row>
                );
              })}
              {staleGrants.map((slug) => (
                <Row key={slug}>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="font-mono text-[13.5px]">{slug}</span>
                      <Pill tone="quiet">not registered</Pill>
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-ink-50">
                      granted, but no tool with this slug is in customTools any more. it shows nowhere.
                    </p>
                  </div>
                  <form action={revokeTool}>
                    <input type="hidden" name="org_id" value={org.id} />
                    <input type="hidden" name="slug" value={slug} />
                    <Submit tone="line" size="sm" pendingLabel="Removing">
                      Remove
                    </Submit>
                  </form>
                </Row>
              ))}
            </>
          )}
        </div>
      </Panel>

      {/* 4. portfolios: what every creator's public page picks up from this workspace */}
      <Panel
        title="Portfolios"
        sub="every creator seated here gets this on their public portfolio page. blank clears it, and a workspace with nothing set leaves their pages exactly as they were."
      >
        <form action={savePortfolioSetup} className="space-y-4">
          <input type="hidden" name="org_id" value={org.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Footer label"
              name="footer_label"
              defaultValue={footer?.label ?? ""}
              placeholder={org.name}
              hint={`replaces "made with creator empire" at the bottom of the page.`}
            />
            <Field
              label="Footer link"
              name="footer_url"
              defaultValue={footer?.url ?? ""}
              placeholder={tenantUrl(org, host)}
              hint="where the label points. blank for no link."
            />
          </div>
          <Field
            label="Badge"
            name="badge"
            defaultValue={badge ?? ""}
            placeholder={`${org.name} creator`}
            hint="one short line under the creator's name. blank for none."
          />
          <div className="flex flex-wrap items-center gap-3">
            <Submit pendingLabel="Saving">Save portfolio setup</Submit>
            <span className="text-[13px] text-ink-50">
              {footer || badge
                ? `on: ${[footer && `footer "${footer.label}"`, badge && `badge "${badge}"`]
                    .filter(Boolean)
                    .join(", ")}`
                : "nothing set. their pages sign off with the product's own mark."}
            </span>
          </div>
        </form>
      </Panel>

      {/* 5. anything else, by hand */}
      <Panel
        title="Everything else on the shelf"
        sub="a key and a value for whatever you build for this workspace next. read it with overrideValue() in lib/org-overrides.ts."
        padded={false}
      >
        {other.length === 0 ? (
          <div className="px-5 py-4 text-[13.5px] text-ink-50 sm:px-6">
            nothing else set. the tool grants and portfolio setup above live in the same table.
          </div>
        ) : (
          other.map((o) => (
            <Row key={o.key}>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[13.5px] font-semibold">{o.key}</p>
                <p className="mt-0.5 truncate font-mono text-[12.5px] text-ink-50">
                  {JSON.stringify(o.value)}
                </p>
                <p className="mt-0.5 text-[12px] text-ink-50">set {ago(o.set_at)}</p>
              </div>
              <form action={deleteOverride}>
                <input type="hidden" name="org_id" value={org.id} />
                <input type="hidden" name="key" value={o.key} />
                <Submit tone="line" size="sm" pendingLabel="Removing">
                  Remove
                </Submit>
              </form>
            </Row>
          ))
        )}

        <div className="border-t border-line px-5 py-5 sm:px-6">
          <form
            action={setOverride}
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end"
          >
            <input type="hidden" name="org_id" value={org.id} />
            <Field
              label="Key"
              name="key"
              placeholder="deals.max_brands"
              hint="lowercase, dots for namespaces."
              required
            />
            <Field
              label="Value"
              name="value"
              placeholder='12, "gold", {"a":1}. blank is true.'
              hint="json if it parses, a string if it does not."
            />
            <div className="flex">
              <Submit size="lg" pendingLabel="Saving">
                Set
              </Submit>
            </div>
          </form>
        </div>
      </Panel>
    </div>
  );
}
