// Shared contract for the editing marketplace. Row shapes mirror the
// 20260809050000_editing migration; every page and action on either side of
// the market imports from here so the two dashboards cannot drift apart.

/**
 * There are no EDITING_ENABLED / EDITOR_HIRING_ENABLED / EDITOR_MARKET_ENABLED
 * flags any more.
 *
 * They were three consts gating a section that was still shipped: /editing, the
 * /editors marketplace, /e/<handle>, the handoff room, the rail row and the
 * dashboard's entry points. On 2026-08-28 all of that was DELETED from this
 * deploy rather than switched off, so a flag promising to bring it back would
 * be pointing at pages that no longer exist. Bringing editing back means
 * copying the routes over from ugc flows, not flipping a boolean.
 *
 * The types and labels below stay: they are what a copied file expects to find
 * and they cost nothing.
 */

export type EditorStatus = "active" | "paused";

/** Where an application sits. Only staff move it, through an rpc. */
export type ApplicationStatus =
  | "new"
  | "reviewing"
  | "test_sent"
  | "hired"
  | "declined";

export type EditorApplication = {
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  discord: string | null;
  location: string | null;
  country: string | null;
  timezone: string | null;
  /** what they speak, their own words: "english, tagalog". */
  languages: string | null;
  /** a portfolio they already had. the one built here lives on `editors`. */
  portfolio_url: string | null;
  software: string[];
  videos_per_day: number | null;
  hours_per_week: number | null;
  weekends: boolean;
  experience: string | null;
  note: string | null;
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
};

/** What each status says to the applicant, in the house voice. */
export const APPLICATION_NOTE: Record<ApplicationStatus, string> = {
  new: "your editor account is live. the board has the open jobs, first claim wins.",
  reviewing: "we're going through your work right now. we'll reach out.",
  test_sent: "we sent you a timed test edit. check your email and dms.",
  hired: "you're in. we'll reach out with your first batch.",
  declined: "not a fit this round. your portfolio stays yours either way.",
};

/** The same five, for the staff list. */
export const APPLICATION_LABEL: Record<ApplicationStatus, string> = {
  new: "new",
  reviewing: "reviewing",
  test_sent: "test sent",
  hired: "hired",
  declined: "declined",
};

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "new",
  "reviewing",
  "test_sent",
  "hired",
  "declined",
];

export type JobStatus =
  | "open"
  | "claimed"
  | "delivered"
  | "revisions"
  | "approved"
  | "cancelled";

export type PayKind = "flat" | "per_video";

/** A link out: raw footage, a style reference, or an editor's social. */
export type LinkItem = { url: string; label: string };

/** One clip on an editor's public reel. */
export type ReelClip = { url: string; title: string; platform: string };

/** 1 = new, 2 = proven, 3 = top. computed nightly, never self-serve. */
export type EditorTier = 1 | 2 | 3;

export const EDITOR_TIER_LABEL: Record<EditorTier, string> = {
  1: "new",
  2: "proven",
  3: "top tier",
};

/** How many jobs an editor can sit on at once (claimed + revisions). */
export const CLAIM_CAPS: Record<EditorTier, number> = { 1: 2, 2: 5, 3: 10 };

export type Editor = {
  user_id: string;
  handle: string;
  published: boolean;
  name: string | null;
  headline: string | null;
  location: string | null;
  avatar_url: string | null;
  bio: string | null;
  skills: string[];
  software: string[];
  links: LinkItem[];
  reel: ReelClip[];
  rate_cents: number | null;
  turnaround_hours: number | null;
  status: EditorStatus;
  tier: EditorTier;
  verified: boolean;
  created_at: string;
  updated_at: string;
};

export type EditJob = {
  id: string;
  user_id: string;
  deal_id: string | null;
  title: string;
  brief: string | null;
  style: string | null;
  format: string | null;
  footage_links: LinkItem[];
  reference_links: LinkItem[];
  pay_kind: PayKind;
  pay_cents: number;
  video_count: number;
  /** 1 = reaction, 2 = full edit. set from the kind picked at post. */
  tier: 1 | 2;
  /** the whole job's price in credits, frozen when it was posted. */
  credits: number;
  is_rush: boolean;
  /** the one included change-of-mind revision round, used or not. */
  change_rounds: number;
  /**
   * The brand this job is for, frozen at post. Stamped onto the job rather
   * than joined, because `deals` and `brands` are scoped to the creator and
   * an editor reading the board can see neither.
   */
  brand_name: string | null;
  brand_logo_key: string | null;
  brand_logo_url: string | null;
  status: JobStatus;
  editor_id: string | null;
  claimed_at: string | null;
  due_at: string | null;
  /** the editor's deadline: claim + 36h (18h rush). null while open. */
  sla_at: string | null;
  /** the first cut ever sent, never rewritten. what on-time is judged off. */
  first_delivered_at: string | null;
  revision_requested_at: string | null;
  /** how many times this job went back for changes, both scopes. */
  revision_count: number;
  /** the creator's word at approval, 1 to 5. optional. */
  rating: number | null;
  rating_note: string | null;
  delivered_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EditJobStrike = {
  id: string;
  editor_id: string;
  job_id: string | null;
  kind: "claim_expired" | "late_release" | "revision_expired";
  created_at: string;
};

export type JobDeliverable = {
  id: string;
  job_id: string;
  editor_id: string;
  url: string;
  note: string | null;
  version: number;
  created_at: string;
};

export type JobEvent = {
  id: string;
  job_id: string;
  author_id: string;
  kind: "comment" | "status";
  body: string;
  created_at: string;
};

export type EditorPayout = {
  id: string;
  job_id: string | null;
  editor_id: string;
  user_id: string;
  amount_cents: number;
  memo: string | null;
  status: "due" | "paid";
  paid_at: string | null;
  created_at: string;
};

/** Chip wording, one place. Lowercase on purpose, house voice. */
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  open: "open",
  claimed: "in edit",
  delivered: "delivered",
  revisions: "revisions",
  approved: "approved",
  cancelled: "cancelled",
};

/** Statuses that still need somebody to do something. */
export const JOB_LIVE_STATUSES: JobStatus[] = [
  "open",
  "claimed",
  "delivered",
  "revisions",
];

/** What the job pays in words: "$120 flat" or "$40 per video, 3 videos". */
export function payLabel(job: Pick<EditJob, "pay_kind" | "pay_cents" | "video_count">): string {
  const dollars = (job.pay_cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: job.pay_cents % 100 === 0 ? 0 : 2,
  });
  if (job.pay_kind === "per_video") {
    const n = job.video_count;
    return `${dollars} per video${n > 1 ? `, ${n} videos` : ""}`;
  }
  return `${dollars} flat`;
}

/** Total owed if the job completes: flat, or per-video times count. */
export function jobTotalCents(
  job: Pick<EditJob, "pay_kind" | "pay_cents" | "video_count">
): number {
  return job.pay_kind === "per_video"
    ? job.pay_cents * job.video_count
    : job.pay_cents;
}

/**
 * The only url the app will store or render: http(s), nothing else. A pasted
 * link without a scheme is read as https rather than rejected; a
 * `javascript:` or `data:` scheme comes back null and the caller drops it.
 * Used on the way in (actions) and on the way out (the coercers below), so a
 * row written before this guard existed still cannot reach an href raw.
 */
export function safeUrl(raw: string): string | null {
  const trimmed = raw.trim().slice(0, 500);
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/+/, "")}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  } catch {
    return null;
  }
  return candidate;
}

/** Loose jsonb from the db into a typed list, dropping malformed entries. */
export function asLinkItems(value: unknown): LinkItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (typeof v !== "object" || v === null) return [];
    const { url, label } = v as Record<string, unknown>;
    if (typeof url !== "string" || url === "") return [];
    const safe = safeUrl(url);
    if (!safe) return [];
    return [{ url: safe, label: typeof label === "string" ? label : "" }];
  });
}

export function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v !== "");
}

export function asReelClips(value: unknown): ReelClip[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (typeof v !== "object" || v === null) return [];
    const { url, title, platform } = v as Record<string, unknown>;
    if (typeof url !== "string" || url === "") return [];
    const safe = safeUrl(url);
    if (!safe) return [];
    return [
      {
        url: safe,
        title: typeof title === "string" ? title : "",
        platform: typeof platform === "string" ? platform : "",
      },
    ];
  });
}

/**
 * How big the batch is, in words: "10 videos". It used to carry the per-video
 * price beside it, back when the batch was a bounty an editor claimed off a
 * board. Nothing is priced here now, and a label reading "$0 each" is worse
 * than one that never mentions money.
 */
export function bundleLabel(job: Pick<EditJob, "video_count">): string {
  const n = Math.max(1, job.video_count);
  return n === 1 ? "1 video" : `${n} videos`;
}

// ------------------------------------------------------------- reliability

/**
 * The numbers a tier is decided from. Pure math over rows the caller already
 * has, so the editor's own desk (RLS-scoped rows) and the cron retier
 * (service rows) compute the identical figure.
 */
export type EditorStats = {
  approved: number;
  /** jobs with both a claim sla and a first delivery: the on-time sample. */
  timed: number;
  /** share of timed jobs delivered inside the sla. null until there is data. */
  onTimeRate: number | null;
  /** median hours from claim to first cut. null until there is data. */
  medianHours: number | null;
  /** share of approved jobs that went back for changes at least once. */
  revisionRate: number | null;
  avgRating: number | null;
  /** full expiries in the last 30 days. the demotion counter. */
  expiries30d: number;
};

type StatJob = Pick<
  EditJob,
  | "status"
  | "claimed_at"
  | "sla_at"
  | "first_delivered_at"
  | "revision_count"
  | "rating"
>;

export function computeEditorStats(
  jobs: StatJob[],
  strikes: Pick<EditJobStrike, "kind" | "created_at">[]
): EditorStats {
  const approvedJobs = jobs.filter((j) => j.status === "approved");
  const timedJobs = jobs.filter((j) => j.sla_at && j.first_delivered_at);

  const onTime = timedJobs.filter(
    (j) => new Date(j.first_delivered_at!) <= new Date(j.sla_at!)
  ).length;

  const hours = jobs
    .filter((j) => j.claimed_at && j.first_delivered_at)
    .map(
      (j) =>
        (new Date(j.first_delivered_at!).getTime() -
          new Date(j.claimed_at!).getTime()) /
        3600_000
    )
    .filter((h) => h >= 0)
    .sort((a, b) => a - b);
  const medianHours =
    hours.length === 0
      ? null
      : hours.length % 2
        ? hours[(hours.length - 1) / 2]
        : (hours[hours.length / 2 - 1] + hours[hours.length / 2]) / 2;

  const ratings = jobs
    .map((j) => j.rating)
    .filter((r): r is number => typeof r === "number" && r >= 1);

  const cutoff = Date.now() - 30 * 24 * 3600_000;

  return {
    approved: approvedJobs.length,
    timed: timedJobs.length,
    onTimeRate: timedJobs.length ? onTime / timedJobs.length : null,
    medianHours,
    revisionRate: approvedJobs.length
      ? approvedJobs.filter((j) => j.revision_count > 0).length / approvedJobs.length
      : null,
    avgRating: ratings.length
      ? ratings.reduce((n, r) => n + r, 0) / ratings.length
      : null,
    expiries30d: strikes.filter(
      (s) => s.kind === "claim_expired" && new Date(s.created_at).getTime() >= cutoff
    ).length,
  };
}

/**
 * The tier those numbers earn. Recomputed from scratch every run rather than
 * promoted/demoted by deltas, so a bad month heals itself the same way it
 * hurt. Three expiries in 30 days, or a real on-time rate under 80%, is tier
 * 1 no matter what else is true.
 */
export function tierFor(s: EditorStats): EditorTier {
  if (s.expiries30d >= 3) return 1;
  if (s.timed >= 5 && s.onTimeRate !== null && s.onTimeRate < 0.8) return 1;
  if (
    s.approved >= 50 &&
    (s.onTimeRate ?? 1) >= 0.95 &&
    (s.avgRating ?? 0) >= 4.5 &&
    (s.revisionRate ?? 0) < 0.2
  ) {
    return 3;
  }
  if (s.approved >= 10 && (s.onTimeRate ?? 1) >= 0.9) return 2;
  return 1;
}

/** Handle rules for the public link: 3-30 chars, a-z 0-9 and dashes. */
export function normalizeHandle(raw: string): string | null {
  const handle = raw.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/.test(handle)) return null;
  return handle;
}

/**
 * The tabs on /editors/settings, and the parser for `?tab=`.
 *
 * Here rather than in profile-editor.tsx, which is where they started: that
 * file is "use client", so anything it exports is a client reference and the
 * server page reading the query string cannot call it. Plain data and a pure
 * function belong on this side of the line anyway, where both halves can see
 * them.
 */
export const SETTINGS_TABS = [
  "profile",
  "availability",
  "editing",
  "payments",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** A url naming a tab we do not have opens on the first one. */
export function toSettingsTab(raw: string | undefined): SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(raw ?? "")
    ? (raw as SettingsTab)
    : "profile";
}
