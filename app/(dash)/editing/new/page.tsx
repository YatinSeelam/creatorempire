import { Crumbs, DashBar, Page } from "@/components/dash/ui";
import { NewJobWizard } from "@/components/dash/new-job-wizard";
import { loadDealOptions } from "@/lib/editing-server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewEditJobPage() {
  const [deals, supabase] = await Promise.all([loadDealOptions(), createClient()]);

  // the uploader needs a folder before the job has an id, and `user/<id>/` is
  // the one the storage policies let this person write to on their own.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <DashBar
        lead={
          <Crumbs
            size="lg"
            trail={[{ label: "Editing", href: "/editing" }, { label: "New job" }]}
          />
        }
      />

      {/* scrolls normally. the summary and the button that leaves the step live
          in a rail that sticks, so the thing `fill` was protecting is protected
          without trapping every card inside its own scroller. */}
      <Page>
        <NewJobWizard deals={deals} userId={user?.id ?? ""} />
      </Page>
    </>
  );
}
