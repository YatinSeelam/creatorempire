import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveCheckingPosts } from "@/lib/autopost/landed-server";

/**
 * Every five minutes: the posts whose publish timed out, found on upload-post's
 * schedule by the file they sent (lib/autopost/landed.ts). It records what is
 * already booked and settles what never was; it never sends, cancels or moves
 * a post. Separate from the hourly refresh so a student waiting on a "being
 * checked" card is minutes from an answer rather than an hour.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = createServiceClient();
  if (!db) {
    return NextResponse.json({ error: "SUPABASE_SECRET_KEY is not set" }, { status: 503 });
  }
  const result = await resolveCheckingPosts(db).catch((e: unknown) => ({
    checked: 0,
    found: 0,
    notBooked: 0,
    error: e instanceof Error ? e.message : "check failed",
  }));
  return NextResponse.json({ ok: true, ...result });
}
