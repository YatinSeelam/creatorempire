import { redirect } from "next/navigation";

/** no marketing site. the front door is the dashboard, and /login catches strangers. */
export default function Root() {
  redirect("/dashboard");
}
