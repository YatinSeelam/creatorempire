"use client";

import { useActionState } from "react";
import {
  postComment,
  recordCutFile,
  sendCut,
  type EditorActionState,
} from "@/app/editors/actions";
import { Area, Field, Note, Submit } from "@/components/dash/form";
import { JobFileUpload } from "@/components/job-files";

const empty: EditorActionState = {};

/**
 * The "send a cut" form. Submitting is the delivery: the server writes the
 * deliverable, flips the job to delivered and drops a status event, so there
 * is no separate "mark as done" step to forget.
 */
export function SendCutForm({
  jobId,
  nextVersion,
}: {
  jobId: string;
  nextVersion: number;
}) {
  const [state, action] = useActionState(sendCut, empty);

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <input type="hidden" name="job_id" value={jobId} />
        <Field
          label={`cut v${nextVersion} link`}
          name="url"
          type="url"
          placeholder="drive.google.com/file/d/..."
          hint="a drive, dropbox or frame.io link the creator can open."
          required
        />
        <Area
          label="note"
          name="note"
          rows={2}
          placeholder="what changed, what to look at first"
        />
        <div className="flex items-center gap-3">
          <Submit pendingLabel="sending">send the cut</Submit>
          <Note state={state} />
        </div>
      </form>

      <div className="border-t border-line pt-4">
        <p className="mb-2 text-[13px] font-semibold text-ink-50">
          or upload the file
        </p>
        <JobFileUpload
          jobId={jobId}
          kind="cut"
          record={recordCutFile}
          label={`upload cut v${nextVersion}`}
          hint="the video itself, up to 500 mb. uploading is the delivery, no link needed."
        />
      </div>
    </div>
  );
}

export function CommentForm({ jobId }: { jobId: string }) {
  const [state, action] = useActionState(postComment, empty);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="job_id" value={jobId} />
      <Area
        label="reply"
        name="body"
        rows={2}
        placeholder="ask a question, flag a blocker"
      />
      <div className="flex items-center gap-3">
        <Submit size="sm" tone="line" pendingLabel="posting">
          post
        </Submit>
        <Note state={state} />
      </div>
    </form>
  );
}
