import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { brand, privacy } from "@/lib/content";

export const metadata: Metadata = {
  title: `${privacy.title} · ${brand.name}`,
  description: `What ${brand.name} collects, why we collect it, and who else sees it.`,
};

export default function Privacy() {
  return <LegalPage doc={privacy} />;
}
