import { csvResponse, oneLine, row } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";

/**
 * The autoposting ledger as a file: every post the composer ever sent or
 * scheduled, one row per post, with the per-platform outcomes flattened into
 * url and error columns. RLS scopes the read to the caller's own rows.
 */
type Outcome = { platform?: string; success?: boolean; url?: string; error?: string };

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in first.", { status: 401 });

  const { data } = await supabase
    .from("social_posts")
    .select("caption, platforms, video_url, scheduled_for, status, results, error, created_at")
    .order("created_at", { ascending: false })
    .limit(2000);

  const lines: string[] = [
    row([
      "created_at",
      "status",
      "platforms",
      "scheduled_for",
      "caption",
      "video_url",
      "posted_urls",
      "errors",
    ]),
  ];

  for (const p of data ?? []) {
    const results: Outcome[] = Array.isArray(p.results) ? p.results : [];
    const posted = results
      .filter((r) => r.success && r.url)
      .map((r) => `${r.platform ?? ""}: ${r.url}`)
      .join(" | ");
    const failed = results
      .filter((r) => r.error)
      .map((r) => `${r.platform ?? ""}: ${r.error}`)
      .join(" | ");

    lines.push(
      row([
        String(p.created_at ?? "").slice(0, 16).replace("T", " "),
        p.status,
        (p.platforms ?? []).join(" "),
        p.scheduled_for ? String(p.scheduled_for).slice(0, 16).replace("T", " ") : "",
        oneLine(p.caption),
        p.video_url ?? "",
        posted,
        oneLine(failed || p.error),
      ])
    );
  }

  return csvResponse("social-posts", lines);
}
