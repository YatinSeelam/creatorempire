import type { Metadata } from "next";
import { Raleway } from "next/font/google";
import { brand, dealRate, pricing } from "@/lib/content";
import { SITE_URL } from "@/lib/site-url";
import "./globals.css";

const raleway = Raleway({
  variable: "--font-raleway",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// The one public origin lives in lib/site-url.ts (NEXT_PUBLIC_SITE_URL, else
// vercel's production host, else localhost) so the sitemap, robots, canonicals
// and og tags all print the same host.
const siteUrl = SITE_URL;

// Read from content.ts rather than written out again. This string is the one
// that ends up in search results and link previews, and the hardcoded copy had
// gone stale: it still said "$750 to $1,000" months after the offer became a
// $750 FLOOR with no cap, which is the weaker of the two claims.
//
// Title order is keyword, promise, brand: "UGC brand deals" is what a creator
// types into google, the guarantee is the reason to click, and the brand is a
// suffix nobody searches for yet. Under 60 characters so it is never cut.
const title = `UGC brand deals in 30 days, or your ${pricing.price} back | ${brand.name}`;
const description = `${pricing.price} a month puts UGC creators in front of brands paying ${dealRate.label} a deal, and runs the deals, the money, the posting and the editors in one app. Do not make it back in 30 days and we refund you.`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  applicationName: brand.name,
  keywords: [
    "ugc brand deals",
    "ugc creator",
    "how to get ugc brand deals",
    "ugc mentorship",
    "ugc coaching",
    "ugc agency for creators",
    "ugc rates",
    "paid brand deals",
    "ugc community",
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: brand.name,
    type: "website",
    locale: "en_US",
    // public/og.png is 1200x630 and says the offer. rendered once by
    // scripts/og-image.mjs, not at request time; the square logo it replaced
    // was cropped by every preview card. pages under this inherit it.
    images: [{ url: "/og.png", width: 1200, height: 630, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
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
