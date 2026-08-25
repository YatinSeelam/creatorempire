/**
 * Rows off supabase into the shared types. The jsonb columns arrive as
 * `unknown` shapes, so everything list-like goes through the lib/editing
 * coercers, which drop malformed entries instead of crashing a page on them.
 */

import {
  asLinkItems,
  asReelClips,
  asStringList,
  type Editor,
  type EditJob,
  type EditorApplication,
} from "@/lib/editing";

export function toEditor(row: Record<string, unknown>): Editor {
  const tier = Number(row.tier ?? 1);
  return {
    ...(row as unknown as Editor),
    skills: asStringList(row.skills),
    software: asStringList(row.software),
    links: asLinkItems(row.links),
    reel: asReelClips(row.reel),
    tier: tier === 3 ? 3 : tier === 2 ? 2 : 1,
  };
}

export function toApplication(row: Record<string, unknown>): EditorApplication {
  return {
    ...(row as unknown as EditorApplication),
    software: asStringList(row.software),
  };
}

export function toJob(row: Record<string, unknown>): EditJob {
  return {
    ...(row as unknown as EditJob),
    footage_links: asLinkItems(row.footage_links),
    reference_links: asLinkItems(row.reference_links),
    tier: Number(row.tier ?? 1) === 2 ? 2 : 1,
    credits: Number(row.credits ?? 0),
    is_rush: Boolean(row.is_rush),
    change_rounds: Number(row.change_rounds ?? 0),
    revision_count: Number(row.revision_count ?? 0),
    rating: typeof row.rating === "number" ? row.rating : null,
  };
}
