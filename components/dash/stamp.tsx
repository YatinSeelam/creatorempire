"use client";

import { useSyncExternalStore } from "react";
import { shortDate } from "@/lib/money";

/**
 * A timestamp the creator can act on: the exact day, the exact minute, and the
 * zone it is in.
 *
 * "fires Aug 10" is not enough for a schedule. Two cuts booked five hours apart
 * on the same day read as one line repeated, and a post set for 11pm reads the
 * same as one set for 8am. What matters is the wall clock the creator lives in,
 * which is why this is a client component: the server renders in UTC and has no
 * way to know the browser's zone.
 *
 * The first paint is `shortDate`, which is UTC and therefore identical on both
 * sides of the wire, so there is no hydration mismatch to suppress. The effect
 * then upgrades it to the local exact time. That ordering is deliberate: a
 * placeholder that is blank until mount makes the row jump, and one that is
 * wrong on the server makes React throw the whole subtree away.
 */

function exactLocal(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** How long until it fires, in the units a person would say it in. */
function untilLocal(iso: string, now: Date): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (Number.isNaN(ms)) return "";
  if (ms <= 0) return "any moment now";

  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `in ${hours}h ${mins % 60}m` : `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `in ${days}d ${hours % 24}h` : `in ${days}d`;
}

/** The same two formats for a caller that already knows it is on the client,
 *  like the composer echoing back the time you just picked. */
export function exactStamp(iso: string): string {
  return exactLocal(iso, new Date());
}
export function untilStamp(iso: string): string {
  return untilLocal(iso, new Date());
}

/** Nothing to subscribe to: the question is only ever "has this mounted yet",
 *  and useSyncExternalStore is how you ask it without a render-triggering
 *  effect. The server snapshot is false, the client's is true, so the first
 *  paint matches the html and the one after it is local. */
const noSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * Has this rendered on the client yet.
 *
 * Anything that depends on the browser — its zone, its localStorage, its idea
 * of "now" — has to render something identical on both sides of the wire first
 * and upgrade after, or React throws the subtree away. This is that question,
 * asked once so every caller answers it the same way.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(noSubscribe, onClient, onServer);
}

export function Stamp({
  iso,
  /** append the countdown. only makes sense for something still to come. */
  until = false,
}: {
  iso: string | null | undefined;
  until?: boolean;
}) {
  const mounted = useSyncExternalStore(noSubscribe, onClient, onServer);

  if (!iso) return <span>unknown</span>;
  if (!mounted) return <span>{shortDate(iso)}</span>;

  const now = new Date();
  const lead = untilLocal(iso, now);
  return <span>{exactLocal(iso, now) + (until && lead ? ` · ${lead}` : "")}</span>;
}
