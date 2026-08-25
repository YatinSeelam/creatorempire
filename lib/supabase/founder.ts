import { redirect } from "next/navigation";
import { createClient } from "./server";

/**
 * The founder gate. /founder is the product's own back office: every person,
 * every workspace, what it all costs. The proxy already turns anonymous
 * traffic away, this is the check that separates a signed-in customer (or an
 * agency's own admin, who is admin of one workspace and nothing here) from a
 * founder of the product.
 *
 * Founder status is not a column anyone can write. `am_i_admin()` asks the
 * database whether the caller's own auth email is on `public.admin_emails`,
 * and the same list is what the row level security policies enforce, so a
 * forged client cannot get further than this page either. The rpc and the
 * table keep the "admin" name they were born with; the role is founder.
 */
export async function requireFounder(next = "/dashboard") {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);

  const { data: isFounder, error } = await supabase.rpc("am_i_admin");

  // a failed check is treated as "not a founder", never as "let them in"
  if (error || !isFounder) redirect("/account?denied=1");

  return { supabase, user };
}

/**
 * `requireFounder()` plus a client that can actually see other people's rows.
 *
 * The two are deliberately separate. Every `*_admin_read` policy now also asks
 * for `private.admin_view()`, which is true only when the request carries
 * `x-admin-view: 1`, so the ordinary client is scoped to `user_id = auth.uid()`
 * even when the person holding it is staff. That is the whole point: /deals,
 * /dashboard and /social read through the same client and never filter by user
 * themselves, and before this a founder saw everybody's deals in their own list.
 *
 * Only the reads behind /founder may use this. If a page is showing somebody
 * their own work, it wants `requireFounder()`.
 */
export async function requireFounderView(next = "/founder") {
  const { user } = await requireFounder(next);
  const supabase = await createClient({ adminView: true });
  return { supabase, user };
}

/** Same question, no redirect. For places that only want to show a link. */
export async function isFounder() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("am_i_admin");
  return data === true;
}
