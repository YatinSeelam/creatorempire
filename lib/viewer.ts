import type { User } from "@supabase/supabase-js";

/** What the chrome needs to show about whoever is signed in. */
export type Viewer = {
  name: string;
  email: string;
  /** google's profile picture, or null when the account has none. */
  avatarUrl: string | null;
  /** the fallback drawn in place of a picture. */
  initial: string;
};

/**
 * Flattens a supabase user into the three strings the nav renders.
 *
 * `user_metadata` is whatever the provider handed back, so every field is
 * optional — google fills `full_name` and `avatar_url`, an email signup fills
 * neither. Anything missing falls back to the email, which always exists.
 */
export function toViewer(user: User): Viewer {
  const meta = user.user_metadata ?? {};
  const email = user.email ?? "";
  const local = email.split("@")[0];

  const name =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    local ||
    "Account";

  const avatarUrl =
    (typeof meta.avatar_url === "string" && meta.avatar_url) ||
    (typeof meta.picture === "string" && meta.picture) ||
    null;

  return {
    name,
    email,
    avatarUrl,
    initial: (email || name).charAt(0).toUpperCase() || "?",
  };
}
