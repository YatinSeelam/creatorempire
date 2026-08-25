"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { setTimezone } from "@/app/(dash)/settings/actions";

/**
 * Tells the server what zone this browser is in, once.
 *
 * Renders nothing. On mount it compares the zone the server rendered with
 * (`current`) to the browser's own; if they differ it writes the cookie and
 * refreshes, so the page it is on redraws in the right zone. After that the
 * cookie agrees and this is a no-op on every page, which is the point of it
 * living in the layout: nobody has to remember to mount it.
 *
 * A move between zones (a creator on a trip) is caught the same way, on the
 * next page they open.
 */
export function TzSync({ current }: { current: string }) {
  const router = useRouter();
  useEffect(() => {
    let mine = "";
    try {
      mine = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    } catch {
      return;
    }
    if (!mine || mine === current) return;
    const body = new FormData();
    body.set("tz", mine);
    void setTimezone(body).then(() => router.refresh());
  }, [current, router]);
  return null;
}
