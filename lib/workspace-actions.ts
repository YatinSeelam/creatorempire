"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AGENCY_HREF } from "@/lib/org";
import { PERSONAL, WS_COOKIE } from "@/lib/workspace";

/**
 * Switch which account you are operating as.
 *
 * Deliberately not validated here. `loadWorkspace()` only matches the cookie
 * against agencies you actually manage, so writing somebody else's org id into
 * it lands you back on your own creator account rather than in their roster.
 * Checking twice would suggest this is the check, and it is not.
 *
 * `revalidatePath("/", "layout")` because the switch repaints the rail, the
 * accent and every screen inside the shell, not just the page being left.
 */
export async function switchWorkspace(form: FormData) {
  const id = String(form.get("id") ?? PERSONAL) || PERSONAL;
  // a plain creator seat: switching in re-skins the dashboard with the
  // agency's branding and modules, it does not open a roster you cannot
  // manage. sending a seat to /agency was how invitees ended up staring at
  // the "create a workspace" screen.
  const kind = String(form.get("kind") ?? "agency");

  (await cookies()).set(WS_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
  redirect(id === PERSONAL || kind === "seat" ? "/dashboard" : AGENCY_HREF);
}
