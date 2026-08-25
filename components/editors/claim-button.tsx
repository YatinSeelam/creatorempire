"use client";

import { useActionState } from "react";
import {
  claimJob,
  releaseClaim,
  type EditorActionState,
} from "@/app/editors/actions";
import { Submit } from "@/components/dash/form";

const empty: EditorActionState = {};

/**
 * One button per open job. The action is race-safe server-side, so losing the
 * race comes back as a sentence on the card rather than a broken workspace;
 * winning redirects straight into the job.
 */
export function ClaimButton({ jobId, size = "sm" }: { jobId: string; size?: "sm" | "lg" }) {
  const [state, action] = useActionState(claimJob, empty);

  return (
    <form action={action} className="flex flex-col items-end gap-1.5">
      <input type="hidden" name="job_id" value={jobId} />
      <Submit size={size} pendingLabel="claiming">
        claim it
      </Submit>
      {state.error && (
        <span className="text-right text-[12.5px] text-flame-dark">{state.error}</span>
      )}
    </form>
  );
}

/**
 * Hand a claim back to the board. The rpc decides whether it was inside the
 * free two-hour window or costs a soft strike; `late` only changes the copy.
 */
export function ReleaseButton({ jobId, late }: { jobId: string; late: boolean }) {
  const [state, action] = useActionState(releaseClaim, empty);

  return (
    <form action={action} className="flex flex-col items-end gap-1.5">
      <input type="hidden" name="job_id" value={jobId} />
      <button
        type="submit"
        className="rounded-pill border border-line px-5 py-2 text-[13.5px] font-semibold text-ink-70 transition-colors hover:text-ink"
      >
        release the claim
      </button>
      <span className="text-right text-[12px] text-ink-50">
        {late
          ? "past the free window, this one counts as a soft strike"
          : "free inside the first 2 hours"}
      </span>
      {state.error && (
        <span className="text-right text-[12.5px] text-flame-dark">{state.error}</span>
      )}
    </form>
  );
}
