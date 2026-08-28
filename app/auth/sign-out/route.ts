import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import { BASE_PATH } from "@/lib/base-path";

/**
 * Sign out, then the login page. `?next=` rides through to the login page so
 * "not you? sign out" on an invite can bring the right account straight back to
 * the invite rather than to a blank sign-in. Same-origin paths only.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const next = safeNext(request.nextUrl.searchParams.get("next"), "");
  // `request.url` carries the base path, but a `/...` second argument replaces
  // the whole path, so the prefix goes back on explicitly.
  const to = next
    ? `${BASE_PATH}/login?next=${encodeURIComponent(next)}`
    : `${BASE_PATH}/login`;
  return NextResponse.redirect(new URL(to, request.url), {
    status: 303,
  });
}
