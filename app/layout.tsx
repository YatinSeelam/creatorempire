import type { Metadata } from "next";
import { Raleway } from "next/font/google";
import { brand } from "@/lib/content";
import { SITE_URL } from "@/lib/site-url";
import "./globals.css";

const raleway = Raleway({
  variable: "--font-raleway",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// The one public origin lives in lib/site-url.ts (NEXT_PUBLIC_SITE_URL, else
// vercel's production host, else localhost) so canonicals and links all print
// the same host.
const siteUrl = SITE_URL;

/**
 * This deploy has no marketing site and no public page.
 *
 * `/` redirects to the dashboard and every route behind it wants a seat on the
 * roster, so the title is the product's name and nothing else. It used to carry
 * the ugc flows offer — a price, a guarantee and a keyword list for a signup
 * page that does not exist here — which is what a browser tab, a bookmark and
 * every link preview were printing.
 *
 * `robots: false` for the same reason. There is nothing here for a crawler to
 * index, and an invite-only workspace showing up in search results is a leak
 * rather than a win.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: brand.name,
  description: `${brand.name} runs brand deals, the money and the posting in one place.`,
  applicationName: brand.name,
  robots: { index: false, follow: false, nocache: true },
  openGraph: {
    title: brand.name,
    url: siteUrl,
    siteName: brand.name,
    type: "website",
    locale: "en_US",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={raleway.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
