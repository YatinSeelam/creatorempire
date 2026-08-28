import type { ReactNode } from "react";
import { EDITING_ENABLED } from "@/lib/editing";
import { EditingSoon } from "./soon";

/**
 * The creator half of the editing market, and on creator empire it is shut.
 *
 * A layout rather than a check per page: /editing, /editing/new and
 * /editing/[id] all sit under it, so a page added later is covered without
 * anyone remembering to. `EditingSoon` is served in place of `children`, which
 * is what makes the three routes under it unreachable rather than merely
 * unlinked.
 *
 * **No founder bypass.** The version before this let `am_i_admin` through so
 * the launch could be rehearsed, which meant the only person who ever looked
 * at this app saw the full marketplace while every student saw a coming-soon
 * page — the one screen nobody could check was the one everybody else got. On
 * this deploy editing is not a launch being rehearsed, it is a section that is
 * not wanted, so there is nothing to rehearse and no reason for two answers.
 * That also drops the `am_i_admin` round trip this layout used to make on
 * every request under it.
 *
 * The code underneath is kept rather than deleted: `lib/editing.ts`, the
 * market pages and `/editors` still exist so a screen changing in ugc flows
 * copies over cleanly. `EDITING_ENABLED` is the only door and it is closed.
 */
export default function EditingLayout({ children }: { children: ReactNode }) {
  if (!EDITING_ENABLED) return <EditingSoon />;
  return children;
}
