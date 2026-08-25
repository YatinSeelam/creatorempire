// Outbound pings: a job hitting the board, and an editor asking to be paid.
// Both go to a discord webhook so nobody has to sit refreshing a page. Best
// effort and fire-safe like lib/email/send.ts — the thing being announced has
// already happened, so a missed ping must never fail it. With
// DISCORD_JOBS_WEBHOOK_URL unset they quietly no-op. Server only.

const TIER_WORD: Record<number, string> = { 1: "reaction", 2: "full edit" };

/** One POST, swallowed. Every ping in this file goes through it. */
async function post(content: string): Promise<boolean> {
  const url = process.env.DISCORD_JOBS_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch (err) {
    console.error("[discord] ping failed", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function notifyJobPosted(job: {
  id: string;
  title: string;
  tier: number;
  credits: number;
  video_count: number;
  is_rush: boolean;
  brand_name?: string | null;
}): Promise<boolean> {
  const per = job.credits > 0 ? Math.round(job.credits / Math.max(1, job.video_count)) : 0;
  const forBrand = job.brand_name ? ` for ${job.brand_name.slice(0, 60)}` : "";

  return post(
    [
      `**new job${forBrand}: ${job.title.slice(0, 150)}**`,
      `${TIER_WORD[job.tier] ?? "edit"} · ${job.video_count} video${
        job.video_count === 1 ? "" : "s"
      } · $${per} each · $${job.credits} total${
        job.is_rush ? " · rush, 18h turnaround" : " · 36h turnaround"
      }`,
      `claim it: https://www.creatorempire.app/editors/market`,
    ].join("\n")
  );
}

/**
 * Somebody took it. Posted so the channel does not keep advertising work that
 * is gone: an editor opening discord an hour later should be able to tell what
 * is actually still up for grabs.
 */
export async function notifyJobClaimed(job: {
  title: string;
  editorName: string;
  hours: number;
  brand_name?: string | null;
}): Promise<boolean> {
  const forBrand = job.brand_name ? ` (${job.brand_name.slice(0, 60)})` : "";
  return post(
    `**claimed:** ${job.title.slice(0, 150)}${forBrand} · taken by ${job.editorName.slice(
      0,
      60
    )} · due in ${job.hours}h`
  );
}

/** Back on the board, either released on purpose or expired on the clock. */
export async function notifyJobReopened(job: {
  title: string;
  reason: "released" | "expired";
  brand_name?: string | null;
}): Promise<boolean> {
  const forBrand = job.brand_name ? ` (${job.brand_name.slice(0, 60)})` : "";
  return post(
    [
      `**back on the board:** ${job.title.slice(0, 150)}${forBrand}`,
      job.reason === "expired"
        ? "the clock ran out, it is open again"
        : "the editor released it, it is open again",
      `claim it: https://www.creatorempire.app/editors/market`,
    ].join("\n")
  );
}

/**
 * An editor asked to be paid. The promise on their screen is same-day, and
 * that is only true if the founder hears about it the moment it happens
 * rather than the next time somebody opens the admin page. So: a discord ping
 * with the amount and the address, and a mail to ADMIN_ALERT_EMAIL as the
 * backstop. Both best effort.
 */
export async function notifyPayoutRequested(input: {
  name: string;
  dueCents: number;
  method: string;
  address: string;
}): Promise<void> {
  const dollars = (input.dueCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: input.dueCents % 100 === 0 ? 0 : 2,
  });

  const url = process.env.DISCORD_JOBS_WEBHOOK_URL;
  if (url) {
    const lines = [
      `**payout requested: ${input.name.slice(0, 100)}**`,
      `${dollars} · ${input.method} · \`${input.address.slice(0, 120)}\``,
      `send it, then mark paid: https://www.creatorempire.app/editors/admin`,
    ];
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: lines.join("\n") }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (err) {
      console.error("[discord] payout ping failed", err instanceof Error ? err.message : err);
    }
  }

  const to = process.env.ADMIN_ALERT_EMAIL;
  if (to) {
    const { notificationHtml, sendEmail } = await import("@/lib/email/send");
    await sendEmail({
      to,
      subject: `payout requested: ${dollars}`,
      html: notificationHtml({
        heading: "an editor asked to be paid",
        lines: [
          `**${input.name}** is owed **${dollars}**.`,
          `send to ${input.method}: **${input.address}**`,
          "they were told it goes out today, so clear it and mark it paid.",
        ],
        cta: { label: "open the queue", url: "https://www.creatorempire.app/editors/admin" },
      }),
    });
  }
}

/**
 * The client said something on a review link.
 *
 * This is the ping the whole feature turns on: the creator sent a url into
 * somebody else's slack and then stopped thinking about it, so the verdict has
 * to come find them rather than wait for the next time they open the job.
 *
 * Discord first because it is free and unconditional, then a mail to the
 * creator if a service key exists to look their address up with. Both best
 * effort: the note is already written, and a missed ping must never fail it.
 */
export async function notifyClientVerdict(input: {
  jobId: string;
  ownerId: string;
  jobTitle: string;
  brandName?: string | null;
  verdict: "approved" | "changes" | "comment";
  reviewerName: string | null;
  body: string | null;
}): Promise<void> {
  const who = input.reviewerName?.trim() || "the client";
  const forBrand = input.brandName ? ` (${input.brandName.slice(0, 60)})` : "";
  const headline =
    input.verdict === "approved"
      ? `**client approved:** ${input.jobTitle.slice(0, 150)}${forBrand}`
      : input.verdict === "changes"
        ? `**client asked for changes:** ${input.jobTitle.slice(0, 150)}${forBrand}`
        : `**client left a note:** ${input.jobTitle.slice(0, 150)}${forBrand}`;

  await post(
    [
      headline,
      `from ${who.slice(0, 60)}${input.body ? `: ${input.body.slice(0, 400)}` : ""}`,
      `https://www.creatorempire.app/editing/${input.jobId}`,
    ].join("\n")
  );

  const { createServiceClient } = await import("@/lib/supabase/service");
  const service = createServiceClient();
  if (!service) return;

  const { emailForUser, notificationHtml, sendEmail } = await import("@/lib/email/send");
  const to = await emailForUser(service, input.ownerId, "notify_edits");
  if (!to) return;

  const lines =
    input.verdict === "approved"
      ? [
          `**${who}** signed off on **${input.jobTitle}**.`,
          "open the job and approve to release the editor's payout. nothing moves until you do.",
        ]
      : input.verdict === "changes"
        ? [
            `**${who}** asked for changes on **${input.jobTitle}**.`,
            "open the job to send their note straight through to the editor.",
          ]
        : [`**${who}** left a note on **${input.jobTitle}**.`];

  if (input.body) lines.push(`"${input.body.slice(0, 600)}"`);

  await sendEmail({
    to,
    subject:
      input.verdict === "approved"
        ? `${who} approved ${input.jobTitle}`
        : input.verdict === "changes"
          ? `${who} asked for changes on ${input.jobTitle}`
          : `${who} left a note on ${input.jobTitle}`,
    html: notificationHtml({
      heading:
        input.verdict === "approved"
          ? "your client approved the cut"
          : input.verdict === "changes"
            ? "your client asked for changes"
            : "your client left a note",
      lines,
      cta: {
        label: "open the job",
        url: `https://www.creatorempire.app/editing/${input.jobId}`,
      },
    }),
  });
}
