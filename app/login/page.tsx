import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { safeNext } from "@/lib/safe-next";

export const metadata: Metadata = {
  title: "Sign in · Creator Empire",
  description: "Sign in to Creator Empire with Google.",
};

/** google only. one workspace, one door. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <AuthShell title="welcome back" sub="sign in with the google account on your seat.">
      <AuthForm next={safeNext(next, "/dashboard")} initialError={error ?? ""} />
    </AuthShell>
  );
}
