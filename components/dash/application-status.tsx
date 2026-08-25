"use client";

import { useActionState } from "react";
import {
  setApplicationStatus,
  type FounderActionState,
} from "@/app/(dash)/founder/editors/actions";
import { Note, Submit } from "@/components/dash/form";
import {
  APPLICATION_LABEL,
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from "@/lib/editing";

const empty: FounderActionState = {};

/**
 * One applicant's status, inline on their row. A bare select plus a button
 * rather than a save-on-change, because "declined" is not a keystroke you want
 * to land by scrolling over a dropdown.
 */
export function ApplicationStatusForm({
  userId,
  status,
}: {
  userId: string;
  status: ApplicationStatus;
}) {
  const [state, action] = useActionState(setApplicationStatus, empty);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <select
        name="status"
        defaultValue={status}
        className="cursor-pointer rounded-pill border border-line bg-shell px-3 py-1.5 text-[12.5px] font-semibold focus:border-flame focus:outline-none"
      >
        {APPLICATION_STATUSES.map((s) => (
          <option key={s} value={s}>
            {APPLICATION_LABEL[s]}
          </option>
        ))}
      </select>
      <Submit tone="line" size="xs" pendingLabel="saving">
        set
      </Submit>
      <Note state={state} />
    </form>
  );
}
