import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign out, then the login page. `?next=` rides through to the login page so
 * "not you? sign out" on an invite can bring the right account straight back to
 * the invite rather than to a blank sign-in. Same-origin paths only.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const next = safeNext(request.nextUrl.searchParams.get("next"), "");
  const to = next ? `/login?next=${encodeURIComponent(next)}` : "/login";
  return NextResponse.redirect(new URL(to, request.url), {
    status: 303,
  });
}
