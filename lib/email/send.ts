/**
 * Outbound email, one function, resend's http api via fetch. No sdk: the
 * dependency would be forty modules for one POST.
 *
 * Every send is best-effort and never throws. An email is a courtesy on top of
 * work that already finished — a sweep that synced fine but could not say so
 * must not report as failed. Callers fire and forget (or await inside
 * `after()`); the boolean is for logging, not control flow.
 *
 * With RESEND_API_KEY unset every send quietly no-ops, so a deploy with no
 * email configured still works end to end. Server only.
 */

const FROM =
  process.env.EMAIL_FROM || "creator empire <notifications@creatorempire.app>";

export type SendEmailInput = {
  to: string;
  subject: string;
  /** plain html body. keep it short — these are notifications, not newsletters. */
  html: string;
};

export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  if (!input.to || !input.to.includes("@")) return false;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("[email] resend refused", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] send failed", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Everything interpolated into the html below runs through this. The lines
 *  routinely carry captions and provider error strings, which are somebody
 *  else's text — an email client will happily render a <script-shaped caption
 *  without it. */
function esc(s: string): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string
  );
}

/**
 * The one look all notification emails share: dark card, lowercase, a heading,
 * a few lines, one link. Matches the product's own voice — no banners, no
 * logos, nothing that smells like a marketing template.
 */
export function notificationHtml(opts: {
  heading: string;
  lines: string[];
  cta?: { label: string; url: string };
}): string {
  // A line is escaped first and only then allowed one piece of markup:
  // `**bold**` becomes <strong>. The order is the whole safety argument. By
  // the time this regex runs, every `<` a caller interpolated is already
  // `&lt;`, so the only thing it can ever emit is our own tag around text
  // that is already inert. The worst a hostile display name achieves is
  // bolding itself.
  //
  // Callers used to write `<strong>` directly, which the escaper turned into
  // visible `&lt;strong&gt;` in the reader's inbox. Every notification this
  // product sends had raw tags in it.
  const bold = (s: string) =>
    s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  const lines = opts.lines
    .map(
      (l) =>
        `<p style="margin:0 0 10px;color:#a1a1aa;font-size:14px;line-height:1.6;">${bold(esc(l))}</p>`
    )
    .join("");
  // links only ever point at our own pages, so anything else becomes inert.
  const safeUrl =
    opts.cta && /^https?:\/\//i.test(opts.cta.url) ? esc(opts.cta.url) : "#";
  const cta = opts.cta
    ? `<a href="${safeUrl}" style="display:inline-block;margin-top:8px;padding:10px 18px;background:#f97316;color:#0a0a0a;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">${esc(opts.cta.label)}</a>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#0a0a0a;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#141416;border:1px solid #27272a;border-radius:12px;padding:28px;">
    <h1 style="margin:0 0 14px;color:#fafafa;font-size:18px;font-weight:600;">${esc(opts.heading)}</h1>
    ${lines}
    ${cta}
    <p style="margin:22px 0 0;color:#52525b;font-size:12px;">ugc flows</p>
  </div>
</body></html>`;
}

/**
 * Where a notification for this person goes, or null for "don't send".
 *
 * `pref` names one of the notify_* booleans already on profiles; a false one
 * means they turned this kind off and null comes back. No pref argument means
 * the send only needs an address (admin alerts, receipts).
 */
export async function emailForUser(
  db: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
  pref?: "notify_deals" | "notify_edits" | "notify_posts"
): Promise<string | null> {
  const { data } = await db
    .from("profiles")
    .select("email, notify_deals, notify_edits, notify_posts")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  if (pref && data[pref] === false) return null;
  const email = (data.email as string | null) ?? null;
  return email && email.includes("@") ? email : null;
}
