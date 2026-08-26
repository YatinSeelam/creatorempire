import Link from "next/link";
import type { ReactNode } from "react";
import { brand } from "@/lib/content";
import { themeVars, type OrgBrand } from "@/lib/org";

/**
 * The page both auth screens sit on. A mark, a line, and the one door.
 *
 * There is no card any more. A bordered panel floating on a grid-paper
 * background was two frames drawn around a single button — the page has one
 * thing on it, so the page IS the frame and the column just centres.
 *
 * `tenant` is the white-label: on a tenant host the mark and name are theirs,
 * because somebody invited by a programme should not meet our brand between the
 * invite and their dashboard. Null paints the product's own.
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
      className="flex min-h-dvh flex-col justify-center bg-shell px-5 py-12"
      style={themeVars(tenant)}
    >
      <div className="mx-auto w-full max-w-[340px]">
        <Link
          href="/"
          className="flex w-fit items-center gap-2 text-[14px] font-bold tracking-[-0.01em]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={tenant?.logo_url || "/logo.png"}
            alt=""
            className="size-6 rounded-md object-cover"
          />
          {tenant?.name ?? brand.wordmark}
        </Link>

        <h1 className="mt-8 text-[22px] font-extrabold leading-[1.15] tracking-[-0.025em]">
          {title}
        </h1>
        {sub && <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-50">{sub}</p>}

        {children}
      </div>
    </main>
  );
}
