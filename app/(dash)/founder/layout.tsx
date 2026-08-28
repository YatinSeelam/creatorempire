import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DashBar, Page, barTitle } from "@/components/dash/ui";
import { requireFounder } from "@/lib/supabase/founder";

export const metadata: Metadata = {
  title: "Founder · Creator Empire",
  robots: { index: false },
};

/**
 * The founder half of the app. One bar, one tab row, and the page under it.
 * Founder is the platform role (admin_emails); an agency's own admin is a
 * workspace role and never reaches this gate.
 *
 * This gate is separate from the (dash) one on purpose: CLAUDE.md says that
 * layout is going to open to paying subscribers, and when it does, everything
 * under /founder has to stay shut. Every page and every action in here checks
 * again for itself, because a server component and a server action are each
 * their own entry point and "the layout already checked" is not a check.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireFounder("/founder");

  return (
    <>
      <DashBar
        lead={<h1 className={barTitle}>Founder</h1>}
        right={
          <span className="hidden text-[13px] text-ink-50 sm:block">
            everyone here, and what it all costs
          </span>
        }
      />

      {/* no tab row. it had two entries, then one, and a nav that names the
          page you are already on is furniture. */}
      <Page className="space-y-6">{children}</Page>
    </>
  );
}
