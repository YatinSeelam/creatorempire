import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { SideNav } from "@/components/dash/side-nav";
import { ViewAsBanner } from "@/components/dash/view-as";
import { requireViewer } from "@/lib/access";
import { loadNotifications } from "@/lib/notify-server";
import { toViewer } from "@/lib/viewer";
import { loadWorkspace } from "@/lib/workspace";
import { readTheme, THEME_COOKIE } from "@/lib/theme";
import { readTz, TZ_COOKIE } from "@/lib/tz";
import { TzSync } from "@/components/tz-sync";

export const metadata: Metadata = {
  title: "Creator Empire",
  robots: { index: false },
};

/**
 * The shell for everything signed in.
 *
 * One workspace, one palette: the navy in globals.css is the product's own
 * paint, so nothing here reads the org's colours or a theme cookie for the
 * accent. Dark mode is still the person's own choice.
 */
export default async function DashLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const theme = readTheme(jar.get(THEME_COOKIE)?.value);
  const tz = readTz(jar.get(TZ_COOKIE)?.value);

  const access = await requireViewer();
  const { user } = access;

  const viewingAs = jar.get("ugcf_viewas")?.value ?? null;

  const [ws, bell] = await Promise.all([loadWorkspace(), loadNotifications()]);

  const viewer = toViewer(user);

  return (
    <div className="dash-shell min-h-dvh bg-shell" data-theme={theme}>
      {viewingAs && <ViewAsBanner name={viewingAs} />}
      <TzSync current={tz} />
      <SideNav
        viewer={viewer}
        notifications={bell.rows}
        unreadNotifications={bell.unread}
        isFounder={access.isFounder}
        agencyRole={ws.agency?.role ?? null}
      />
      <main className="px-5 py-7 sm:px-6 lg:ml-[232px]">{children}</main>
    </div>
  );
}
