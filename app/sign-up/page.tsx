import { redirect } from "next/navigation";

/** no self serve signup here. a seat is handed out by the programme, and the door is /login. */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
}
