"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Crumbs, Pill } from "./ui";
import { PortfolioSite } from "@/components/portfolio/portfolio-site";
import { portfolioFontVars } from "@/lib/portfolio-fonts";
import type { PortfolioAgency } from "@/lib/org-overrides";
import { portfolioUrl, type Portfolio } from "@/lib/portfolio-schema";

/**
 * The portfolio at real size, before anyone else can see it.
 *
 * The editor's phone is for typing next to; this is for the last look before a
 * link goes to a brand. It has to work while the page is still a draft, which
 * is why it lives under (dash) behind the same gate as the editor instead of
 * reusing the public /<slug> route — that route only ever serves
 * published portfolios and always will.
 *
 * PortfolioSite lays itself out with container queries, so a frame set to
 * 1440px renders the desktop layout even though the browser window is narrower.
 * That is what makes a device switcher meaningful here rather than a lie.
 *
 * The frame sets no theme vars of its own. `PortfolioSite` writes them on
 * itself, which is exactly what lets it be dropped into a device frame, a phone
 * or a full page with no wrapper — and it is why the creator's background stops
 * at the edge of the device here rather than flooding the desk.
 */

const DEVICES = [
  { key: "desktop", label: "Desktop", width: 1440 },
  { key: "laptop", label: "Laptop", width: 1180 },
  { key: "tablet", label: "Tablet", width: 834 },
  { key: "phone", label: "Phone", width: 390 },
] as const;

type DeviceKey = (typeof DEVICES)[number]["key"];

const ZOOMS = [
  { key: "fit", label: "Fit" },
  { key: "full", label: "100%" },
] as const;

type ZoomKey = (typeof ZOOMS)[number]["key"];

export function PortfolioPreview({
  portfolio,
  agency = null,
}: {
  portfolio: Portfolio;
  agency?: PortfolioAgency | null;
}) {
  const [device, setDevice] = useState<DeviceKey>("desktop");
  const [zoom, setZoom] = useState<ZoomKey>("fit");

  const [columnRef, available] = useElementSize<HTMLDivElement>(readWidth);
  const [frameRef, natural] = useElementSize<HTMLDivElement>(readHeight);

  const width = (DEVICES.find((d) => d.key === device) ?? DEVICES[0]).width;

  // Fit shrinks, it never grows: a 390px phone blown up to the width of the
  // column would stop being a phone preview. Anything already narrower than the
  // space available is left alone.
  const scale =
    zoom === "fit" && available > 0 && width > available ? available / width : 1;
  const scaled = scale < 1;

  const url = portfolioUrl(portfolio.slug);

  return (
    // Edge to edge, the same negative margins DashBar uses to cancel the
    // layout's padding. The bottom one is here too so the desk runs off the
    // end of the page rather than stopping in a band of white.
    <div className="-mx-5 -mb-7 -mt-7 sm:-mx-6">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line bg-paper px-5 py-3 sm:px-6">
        <Crumbs
          trail={[
            { label: "Portfolio", href: "/portfolio" },
            { label: "Preview" },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Device width"
            options={DEVICES.map((d) => ({
              key: d.key,
              label: d.label,
              note: String(d.width),
            }))}
            value={device}
            onChange={setDevice}
          />
          <Segmented label="Zoom" options={ZOOMS} value={zoom} onChange={setZoom} />
        </div>

        <div className="ml-auto min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {portfolio.published ? (
              <Link
                href={`/${portfolio.slug}`}
                className="truncate text-[14px] font-semibold text-flame transition-colors hover:text-flame-dark"
              >
                {url}
              </Link>
            ) : (
              <span className="truncate text-[14px] font-semibold text-ink-50">
                {url}
              </span>
            )}
            <Pill tone={portfolio.published ? "flame" : "quiet"}>
              {portfolio.published ? "Published" : "Draft"}
            </Pill>
          </div>
          {!portfolio.published && (
            <p className="mt-0.5 text-[12px] text-ink-50">
              goes live once you publish
            </p>
          )}
        </div>
      </header>

      {/* The desk. The inset shadow under the toolbar is what stops the frame
          from reading as another block of the page. */}
      <div className="min-h-[70vh] bg-shell shadow-[inset_0_8px_20px_-14px_rgb(16_16_16/0.3)]">
        <div className="px-5 py-8 sm:px-6 sm:py-10">
          {/* Clip rather than hidden while scaling: the scaled frame's layout
              box is still full device width and would otherwise raise a
              horizontal scrollbar over nothing. `clip` on one axis leaves the
              other visible, `hidden` would silently make it scroll. */}
          <div
            ref={columnRef}
            className={zoom === "full" ? "overflow-x-auto" : "overflow-x-clip"}
          >
            {/* The holder carries the *scaled* size. A transform does not
                change layout, so without this the page would keep a gap the
                height of an unscaled 1440px portfolio underneath. */}
            <div
              className="relative mx-auto"
              style={{
                width: width * scale,
                height: scaled ? natural * scale : undefined,
              }}
            >
              <div
                ref={frameRef}
                className={`${portfolioFontVars} overflow-hidden rounded-card border border-line bg-paper shadow-[0_30px_60px_-40px_rgb(16_16_16/0.5)]`}
                style={
                  scaled
                    ? {
                        width,
                        position: "absolute",
                        top: 0,
                        // left:50% minus half the natural width centres the
                        // layout box on the holder; scaling from top centre
                        // then keeps that centre, so the visual edges land
                        // exactly on the holder's.
                        left: "50%",
                        marginLeft: -width / 2,
                        transform: `scale(${scale})`,
                        transformOrigin: "top center",
                      }
                    : { width }
                }
              >
                <PortfolioSite portfolio={portfolio} mode="live" agency={agency} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- controls */

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { key: T; label: string; note?: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-0.5 rounded-md border border-line bg-paper p-0.5"
    >
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            className={`flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-[13px] font-semibold transition-colors ${
              on ? "bg-ink text-paper" : "text-ink-50 hover:text-ink"
            }`}
          >
            {o.label}
            {o.note && (
              <span
                className={`hidden text-[11px] tabular-nums sm:inline ${
                  on ? "text-paper/60" : "text-ink-50/70"
                }`}
              >
                {o.note}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- measurement */

const readWidth = (el: HTMLElement) => el.clientWidth;
const readHeight = (el: HTMLElement) => el.offsetHeight;

/**
 * Measure an element, not the window.
 *
 * The dash rail is 232px of fixed chrome from lg up, so anything derived from
 * innerWidth is wrong by exactly that much and the fit scale would leave the
 * frame overhanging. Both readers are deliberately layout values rather than
 * getBoundingClientRect: they ignore the transform, so the frame keeps
 * reporting its natural height while it is being scaled by that same height.
 */
function useElementSize<T extends HTMLElement>(
  read: (el: HTMLElement) => number
): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver(() => setSize(read(el)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [read]);

  return [ref, size];
}
