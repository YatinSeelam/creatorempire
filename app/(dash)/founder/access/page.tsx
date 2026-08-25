import type { Metadata } from "next";
import {
  AddFounderForm,
  RemoveFounderForm,
  RoleSwitchForm,
} from "@/components/dash/founder-controls";
import { Panel, Pill, Row } from "@/components/dash/ui";
import { requireFounder } from "@/lib/supabase/founder";

export const metadata: Metadata = {
  title: "Access · Creator Empire",
  robots: { index: false },
};

export default async function AccessPage() {
  const { supabase, user } = await requireFounder("/founder/access");

  const { data: admins } = await supabase
    .from("admin_emails")
    .select("email, role, created_at")
    .order("created_at", { ascending: true });

  const me = user.email?.toLowerCase() ?? "";
  const rows = admins ?? [];

  return (
    <div className="space-y-6">
      <p className="max-w-[68ch] text-[14.5px] leading-[1.6] text-ink-50">
        Two grants. A <strong>creator</strong> gets the dashboard, deals and
        tools, and nothing else: no this page, no other person&rsquo;s rows, no
        editing market. A <strong>founder</strong> gets all of that plus the
        back office. Nobody outside this list gets in without paying or holding
        an agency seat.
      </p>

      <Panel title="Grant access">
        <AddFounderForm />
        <p className="mt-4 text-[13.5px] leading-[1.6] text-ink-50">
          Use the email they sign in with. They do not need an account yet. The
          access is waiting the moment they create one. It has to be that exact
          address, Google or password either way.
        </p>
      </Panel>

      <Panel title={`On the list (${rows.length})`} padded={false}>
        {rows.map((a) => {
          const isMe = a.email === me;
          const role = String(a.role ?? "founder");
          return (
            <Row key={a.email}>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold tracking-[-0.01em]">
                  {a.email}
                </p>
                <p className="mt-1 text-[13px] text-ink-50">
                  Added{" "}
                  {new Date(a.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <Pill tone={role === "founder" ? "flame" : "quiet"}>{role}</Pill>
                {isMe && <Pill tone="flame">You</Pill>}
                <RoleSwitchForm email={a.email} role={role} disabled={isMe} />
                <RemoveFounderForm email={a.email} disabled={isMe} />
              </div>
            </Row>
          );
        })}
      </Panel>

      <p className="text-[13.5px] leading-[1.6] text-ink-50">
        You cannot remove or demote yourself, and the last founder cannot be
        removed or demoted. Every one of those rules is enforced by the
        database, not by this page.
      </p>
    </div>
  );
}
