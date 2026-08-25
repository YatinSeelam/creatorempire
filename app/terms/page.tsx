import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { brand, terms } from "@/lib/content";

export const metadata: Metadata = {
  title: `${terms.title} · ${brand.name}`,
  description: `The agreement between you and ${brand.name}. What the service is, what you pay, how to cancel, and how the guarantee works.`,
};

export default function Terms() {
  return <LegalPage doc={terms} />;
}
