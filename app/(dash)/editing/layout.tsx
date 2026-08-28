import type { ReactNode } from "react";
import { EDITING_ENABLED } from "@/lib/editing";
import { createClient } from "@/lib/supabase/server";
import { EditingSoon } from "./soon";

/**
 * The creator half of the editing market.
 *
 * A layout rather than a check per page: /editing, /editing/new and
 * /editing/[id] all sit under it, so a page added later is covered without
 * anyone remembering to.
 *
 * While EDITING_ENABLED is off the founder still gets in: buying credits,
 * posting a test job and watching it flow is how the launch gets rehearsed,
 * and rls plus the rpcs treat a founder like any other creator underneath.
 *
 * Everyone else gets `EditingSoon` rather than the 404 this used to throw. The
 * rail still carries an Editing row, so a 404 was the app contradicting itself:
 * a link the product draws must not lead to "this does not exist". The soon
 * page is served in place of `children`, which is what keeps the three routes
 * under it unreachable rather than merely unlinked.
 */
export default async function EditingLayout({ children }: { children: ReactNode }) {
  if (!EDITING_ENABLED) {
    const supabase = await createClient();
    const { data: isFounder, error } = await supabase.rpc("am_i_admin");
    // a failed read is not a founder. same fail-closed rule as every other gate.
    if (error || !isFounder) return <EditingSoon />;
  }
  return children;
}
