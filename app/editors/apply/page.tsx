import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApplyForm } from "@/components/editors/apply-form";
import { toApplication } from "@/components/editors/coerce";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Your application · Creator Empire",
  robots: { index: false },
};

/**
 * Correcting an application after it is in. The overview owns the first
 * submission, because that is where the job post is; this page is only ever
 * reached from the "fix your application" link, so a visitor with no row on
 * file belongs back on the overview rather than looking at a second empty form.
 */
export default async function EditorApplyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/editors");

  const [{ data }, { data: portfolio }] = await Promise.all([
    supabase
      .from("editor_applications")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
    // the photo lives on `editors`, not on the application, so the picker has
    // something to show instead of asking for it again.
    supabase
      .from("editors")
      .select("avatar_url")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (!data) redirect("/editors");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[clamp(1.5rem,3.4vw,1.95rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
          your application
        </h1>
        <p className="mt-2 text-[14.5px] text-ink-50">
          change anything here and save. we read the latest version.
        </p>
      </div>
      <ApplyForm
        initial={toApplication(data as Record<string, unknown>)}
        defaultEmail={user.email ?? ""}
        userId={user.id}
        avatarUrl={(portfolio?.avatar_url as string | null) ?? ""}
      />
    </div>
  );
}
