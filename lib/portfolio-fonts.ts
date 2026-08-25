import { DM_Sans, Instrument_Serif, Raleway } from "next/font/google";
import localFont from "next/font/local";

/**
 * The four faces a creator can dress their portfolio in.
 *
 * They live in their own module, imported only by the portfolio template and
 * the editor that previews it, so the landing page never pays to download three
 * fonts nobody asked for. next/font only emits the CSS for the routes that
 * actually pull this file in.
 *
 * Every one declares a `--pf-font-<key>` variable matching a FontKey in
 * portfolio-schema, and portfolio-theme points `--pf-font` at whichever is
 * chosen. Adding a face means adding it in both places and nowhere else.
 */

const raleway = Raleway({
  variable: "--pf-font-raleway",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

/**
 * Space Grotesk is the one face served from the repo rather than fetched at
 * build time.
 *
 * `next/font/google` downloads the woff2 while the build runs, and google
 * rotated Space Grotesk's file urls out from under the cached css: every
 * request 404'd and turbopack could not resolve the font module, which failed
 * the whole production build on a page nobody had touched. The other three
 * faces still resolve, so they stay as they are; this one is four latin files
 * of about 13kb each, committed, and no longer anybody else's uptime.
 */
const grotesk = localFont({
  variable: "--pf-font-grotesk",
  display: "swap",
  src: [
    { path: "./fonts/space-grotesk-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/space-grotesk-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/space-grotesk-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/space-grotesk-700.woff2", weight: "700", style: "normal" },
  ],
});

// one weight only — it is a display serif and its 400 is already the look
const serif = Instrument_Serif({
  variable: "--pf-font-serif",
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
});

const dm = DM_Sans({
  variable: "--pf-font-dm",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

/** Put this on any element that contains a rendered portfolio. All four
 *  variables have to be in scope, because the accent picker can switch fonts
 *  without a reload. */
export const portfolioFontVars = [
  raleway.variable,
  grotesk.variable,
  serif.variable,
  dm.variable,
].join(" ");
