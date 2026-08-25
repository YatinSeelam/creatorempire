import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DashBar, Pill, barTitle } from "@/components/dash/ui";
import { ORGS_ENABLED, ROLE_LABEL } from "@/lib/org";
import { requireAgency } from "@/lib/workspace";

/**
 * The agency half of the app: somebody else's roster, run by you.
 *
 * One gate and one bar for the three pages under it. The bar carries the
 * workspace's identity — name, your role on it, the address its creators use —
 * because that is the question you want answered on every screen in here and it
 * is the one thing all three pages share. What each page IS gets said by the
 * rail, which has swapped its whole nav for this section.
 *
 * `requireAgency()` sends anyone who manages nothing to /new. There is nothing
 * to look at otherwise, and a permission error would be the wrong story: they
 * are not being refused, they have not made one.
 */
export default async function AgencyLayout({ children }: { children: ReactNode }) {
  // the whole layer behind one const (ORGS_ENABLED in lib/org.ts). A 404 rather
  // than a redirect: while it is off the route genuinely is not part of the
  // product, and bouncing somebody home would read as a permission problem.
  if (!ORGS_ENABLED) notFound();

  const agency = await requireAgency();


  return (
    <>
      <DashBar
        lead={
          <div className="flex min-w-0 items-center gap-3">
            <h1 className={barTitle}>{agency.name}</h1>
            <Pill tone="quiet">{ROLE_LABEL[agency.role]}</Pill>
          </div>
        }
      />
      {children}
    </>
  );
}
