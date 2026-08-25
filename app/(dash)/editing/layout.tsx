import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { EDITING_ENABLED } from "@/lib/editing";
import { createClient } from "@/lib/supabase/server";

/**
 * The creator half of the editing market.
 *
 * A layout rather than a check per page: /editing, /editing/new and
 * /editing/[id] all sit under it, so a page added later is covered without
 * anyone remembering to. notFound rather than a redirect because the feature
 * is hidden, not moved, and a 404 says nothing about what exists.
 *
 * While EDITING_ENABLED is off the founder still gets in: buying credits,
 * posting a test job and watching it flow is how the launch gets rehearsed,
 * and rls plus the rpcs treat a founder like any other creator underneath.
 */
export default async function EditingLayout({ children }: { children: ReactNode }) {
  if (!EDITING_ENABLED) {
    const supabase = await createClient();
    const { data: isFounder, error } = await supabase.rpc("am_i_admin");
    if (error || !isFounder) notFound();
  }
  return children;
}
