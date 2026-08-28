/**
 * What somebody is allowed to do here, as one word. Three states and no more.
 *
 * Its own file, with no imports, because all three sides need it: the reads in
 * lib/founder.ts, the write in app/(dash)/founder/actions.ts, and the picker in
 * components/dash/access-picker.tsx, which is a client component and cannot
 * pull a module that reaches for `next/headers`.
 *
 * The three map exactly onto what `lib/access.ts` `isEntitled` reads, which is
 * what makes them safe to render as a control:
 *
 *   founder   a row on `admin_emails` with role 'founder'. Reaches /founder.
 *   student   a seat on the one workspace. The programme's books, their work.
 *   none      an account and no way in. They land on /account.
 *
 * Founder wins when somebody holds both, because it is the wider grant.
 */
export type AccessLevel = "none" | "student" | "founder";

export const ACCESS_LEVELS: { value: AccessLevel; label: string }[] = [
  { value: "none", label: "no access" },
  { value: "student", label: "student" },
  { value: "founder", label: "founder" },
];

export function accessOf(p: {
  grant_role: string | null;
  seat_role: string | null;
}): AccessLevel {
  if (p.grant_role === "founder") return "founder";
  if (p.seat_role) return "student";
  return "none";
}
