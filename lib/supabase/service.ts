import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * The service-key client. It bypasses row level security, so it may only ever
 * be constructed inside a route handler that has already authenticated the
 * caller some other way — right now that is the stripe webhook, which proves
 * itself with a signature.
 *
 * Never import this from a client component and never from a server component
 * that renders user-controlled input. `SUPABASE_SECRET_KEY` has no
 * NEXT_PUBLIC_ prefix for that reason: the bundler will refuse to ship it.
 *
 * Returns null when the key is not set, so a deploy that has not been given
 * one fails loudly at the call site instead of silently writing nothing.
 */
export function createServiceClient() {
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
