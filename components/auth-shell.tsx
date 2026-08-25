import Link from "next/link";
import type { ReactNode } from "react";
import { brand } from "@/lib/content";
import { themeVars, type OrgBrand } from "@/lib/org";

/**
 * The card both auth pages sit in. Wordmark up top, one panel, nothing else.
 *
 * `tenant` is the white-label: on klypr.ugcflows.com the header is klypr's
 * logo and name and the accent is theirs, because a creator invited by an
 * agency should never meet our brand between the invite and their dashboard.
 * Null paints the product's own mark and palette, exactly as before.
 */
export function AuthShell({
  title,
  sub,
  tenant = null,
  children,
}: {
  title: string;
  sub?: string;
  tenant?: OrgBrand | null;
  children: ReactNode;
}) {
  return (
    <main
      className="grid-paper flex min-h-dvh flex-col justify-center px-5 py-12 sm:px-6 sm:py-16"
      style={themeVars(tenant)}
    >
      <div className="mx-auto w-full max-w-[480px]">
        <Link
          href="/"
          className="mx-auto flex w-fit items-center gap-2.5 text-[19px] font-extrabold tracking-[-0.02em]"
        >
          {tenant?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tenant.logo_url}
              alt=""
              className="size-8 rounded-[9px] object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/logo.png" alt="" className="size-9 rounded-[10px] object-cover" />
          )}
          {tenant?.name ?? brand.wordmark}
        </Link>

        <div className="mt-7 rounded-card border border-line bg-paper p-6 sm:mt-8 sm:p-10">
          <h1 className="text-[clamp(1.5rem,4vw,1.9rem)] font-extrabold leading-[1.15] tracking-[-0.025em]">
            {title}
          </h1>
          {sub && (
            <p className="mt-3 text-[15px] leading-[1.6] text-ink-50">{sub}</p>
          )}
          {children}
        </div>
      </div>
    </main>
  );
}
