import { brand, dealRate, faq, guarantee, pricing } from "@/lib/content";
import { absoluteUrl, SITE_URL } from "@/lib/site-url";

/**
 * Structured data, in one place. Every marketing page prints one or more of
 * these through <JsonLd>. The numbers are read from content.ts, so a price
 * change on the page is a price change in the rich result too, and the two
 * can never disagree in a google search snippet.
 *
 * Kept deliberately small: Organization + WebSite on the home page (entity
 * recognition, sitelinks search box), Product with an Offer (price rich
 * result), FAQPage where a page has a faq. Nothing speculative.
 */

export const ORG_ID = `${SITE_URL}/#organization`;
export const SITE_ID = `${SITE_URL}/#website`;

export function organizationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: brand.name,
    alternateName: brand.wordmark,
    url: SITE_URL,
    logo: absoluteUrl("/logo.png"),
    email: brand.contactEmail,
    description: brand.tagline,
    contactPoint: [
      {
        "@type": "ContactPoint",
        email: brand.contactEmail,
        contactType: "customer support",
        availableLanguage: "en",
      },
    ],
  };
}

export function websiteLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": SITE_ID,
    name: brand.name,
    url: SITE_URL,
    publisher: { "@id": ORG_ID },
    inLanguage: "en",
  };
}

/**
 * The creator seat as a Product. `priceValidUntil` is left off on purpose:
 * google warns when it is missing but rejects one that has passed, and a
 * date that has to be bumped by hand will be forgotten.
 */
export function productLd(opts: { url?: string; name?: string; description?: string } = {}) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: opts.name || `${brand.name} membership`,
    description:
      opts.description ||
      `${pricing.price} a month. Brand deals placed for you, starting with one paying ${dealRate.label}, plus coaching calls, a creator community, editors, a built portfolio and the app that runs the deals, the money and the posting. ${guarantee.title}.`,
    brand: { "@type": "Brand", name: brand.name },
    url: absoluteUrl(opts.url || "/"),
    image: absoluteUrl("/logo.png"),
    offers: {
      "@type": "Offer",
      url: absoluteUrl(pricing.signupUrl),
      price: pricing.price.replace(/[^0-9.]/g, ""),
      priceCurrency: "USD",
      availability: "https://schema.org/LimitedAvailability",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: pricing.price.replace(/[^0-9.]/g, ""),
        priceCurrency: "USD",
        unitText: "MONTH",
        billingIncrement: 1,
      },
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: 30,
        refundType: "https://schema.org/FullRefund",
        returnFees: "https://schema.org/FreeReturn",
        description: `${guarantee.promise} ${guarantee.conditions}`,
      },
      seller: { "@id": ORG_ID },
    },
  };
}

export type FaqItem = { q: string; a: string };

/** google shows faq rich results only for pages whose visible faq matches. */
export function faqLd(items: FaqItem[] = faq.items) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function breadcrumbLd(trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      item: absoluteUrl(t.path),
    })),
  };
}
