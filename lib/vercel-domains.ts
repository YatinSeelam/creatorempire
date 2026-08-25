/**
 * Custom domains, attached to the vercel project so they actually serve.
 *
 * `orgs.custom_domain` on its own is a lookup key: `loadWorkspace()` and
 * `loadBrand()` already resolve a request on that host to the org. What it does
 * not do is make the host reach us. That takes two things: the agency points a
 * dns record at vercel, and the domain is added to THIS project so vercel routes
 * it here and issues the certificate. The first is theirs, the second is this
 * file, through vercel's rest api with a token that lives only on the server.
 *
 * Every function degrades: with no VERCEL_TOKEN the answer is `supported:
 * false`, the branding page still stores the domain and shows the dns records,
 * and attaching it becomes a hand step. Nothing here throws; the domain form
 * is a courtesy on top of a column write that must not fail because vercel
 * had a bad minute.
 *
 * Env: VERCEL_TOKEN (a personal or team token with project scope),
 * VERCEL_PROJECT_ID (prj_… from .vercel/project.json), VERCEL_TEAM_ID
 * (team_…, optional for a personal account).
 */

const API = "https://api.vercel.com";

/** The record an agency adds at their dns provider. Vercel's published targets. */
export const DNS_CNAME_TARGET = "cname.vercel-dns.com";
export const DNS_APEX_A = "76.76.21.21";

export type DomainRecord = { type: string; name: string; value: string };

export type DomainStatus =
  | { supported: false }
  | {
      supported: true;
      /** attached to the project. false when nobody has added it yet. */
      attached: boolean;
      /** ownership verified. vercel asks for a TXT when the domain is claimed elsewhere. */
      verified: boolean;
      /** dns actually points at us. */
      configured: boolean;
      /** what still has to be added at their provider, if anything. */
      records: DomainRecord[];
      /** a human line for the page when something is off. */
      message: string | null;
    };

function config() {
  const token = process.env.VERCEL_TOKEN;
  const project = process.env.VERCEL_PROJECT_ID;
  if (!token || !project) return null;
  return { token, project, team: process.env.VERCEL_TEAM_ID || null };
}

async function call(
  path: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const c = config();
  if (!c) return { ok: false, status: 0, body: {} };
  const url = new URL(`${API}${path}`);
  if (c.team) url.searchParams.set("teamId", c.team);
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${c.token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    console.error("[vercel] request failed", err instanceof Error ? err.message : err);
    return { ok: false, status: 0, body: {} };
  }
}

/** Is this an apex (acme.com) rather than a subdomain (app.acme.com)? */
function isApex(domain: string): boolean {
  return domain.split(".").length === 2;
}

/** The record they need whether or not vercel is wired: the pointing half. */
export function pointingRecord(domain: string): DomainRecord {
  return isApex(domain)
    ? { type: "A", name: "@", value: DNS_APEX_A }
    : { type: "CNAME", name: domain.split(".")[0], value: DNS_CNAME_TARGET };
}

/**
 * Add the domain to the project. Idempotent enough: a domain that is already on
 * this project comes back as attached rather than as an error.
 */
export async function attachDomain(
  domain: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!config()) return { ok: true }; // nothing to do, and not a failure
  const c = config()!;
  const r = await call(`/v10/projects/${c.project}/domains`, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });
  if (r.ok) return { ok: true };
  const err = (r.body.error ?? {}) as { code?: string; message?: string };
  if (err.code === "domain_already_in_use" || r.status === 409) {
    // in use by THIS project is fine; by another one is the real conflict.
    const mine = await call(`/v9/projects/${c.project}/domains/${domain}`);
    if (mine.ok) return { ok: true };
    return {
      ok: false,
      message: `${domain} is attached to another vercel project. Remove it there first, or use a different subdomain.`,
    };
  }
  return {
    ok: false,
    message: err.message
      ? `vercel refused ${domain}: ${err.message}`
      : `vercel refused ${domain} (${r.status || "network"}). Try again in a minute.`,
  };
}

/** Take a domain back off the project. Missing is fine. */
export async function detachDomain(domain: string): Promise<void> {
  const c = config();
  if (!c) return;
  await call(`/v9/projects/${c.project}/domains/${domain}`, { method: "DELETE" });
}

/** Where a domain stands, for the branding page. */
export async function domainStatus(domain: string): Promise<DomainStatus> {
  const c = config();
  if (!c) return { supported: false };

  const got = await call(`/v9/projects/${c.project}/domains/${domain}`);
  if (!got.ok) {
    return {
      supported: true,
      attached: false,
      verified: false,
      configured: false,
      records: [pointingRecord(domain)],
      message:
        got.status === 404
          ? "not attached yet. save the domain again to attach it."
          : "could not reach vercel to check. the records below are still right.",
    };
  }

  const verified = got.body.verified === true;
  const verification = Array.isArray(got.body.verification)
    ? (got.body.verification as { type?: string; domain?: string; value?: string }[])
    : [];

  // ownership records vercel wants before it will serve a domain that is on
  // another account somewhere. shown as-is; they are exact strings.
  const records: DomainRecord[] = verification.map((v) => ({
    type: v.type ?? "TXT",
    name: v.domain ?? domain,
    value: v.value ?? "",
  }));

  // the pointing half. `misconfigured` is vercel reading their dns for us.
  const cfg = await call(`/v6/domains/${domain}/config`);
  const configured = cfg.ok && cfg.body.misconfigured === false;
  if (!configured) records.push(pointingRecord(domain));

  return {
    supported: true,
    attached: true,
    verified,
    configured,
    records,
    message: !verified
      ? "vercel needs the TXT record below to prove the domain is yours."
      : !configured
        ? "attached. it goes live once the record below is in place; dns can take up to an hour."
        : null,
  };
}

/** Ask vercel to re-check ownership. Cheap, safe to press. */
export async function verifyDomain(domain: string): Promise<void> {
  const c = config();
  if (!c) return;
  await call(`/v9/projects/${c.project}/domains/${domain}/verify`, { method: "POST" });
}
