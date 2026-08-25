"use client";

import { useActionState, useState } from "react";
import {
  submitEditorApplication,
  type EditorActionState,
} from "@/app/editors/actions";
import { Area, Field, Label, Note, Submit } from "@/components/dash/form";
import { AvatarPicker } from "@/components/editors/avatar-picker";
import { Panel } from "@/components/editors/ui";
import type { EditorApplication } from "@/lib/editing";

const empty: EditorActionState = {};

/**
 * The application. One form, three panels, one submit.
 *
 * Deliberately short. Everything here is either how we reach you or how we
 * decide, and anything that is neither belongs on the portfolio page instead,
 * where it can be filled in later without standing between somebody and their
 * application. `initial` is present when they are correcting an answer.
 */
export function ApplyForm({
  initial,
  defaultEmail,
  userId,
  avatarUrl = "",
}: {
  initial?: EditorApplication | null;
  defaultEmail?: string;
  userId: string;
  avatarUrl?: string;
}) {
  const [state, action] = useActionState(submitEditorApplication, empty);
  const has = initial != null;
  const num = (n: number | null | undefined) => (n == null ? "" : String(n));
  // the photo is the one field here that is not a plain input. it uploads on
  // pick and what the form carries is the url it got back.
  const [avatar, setAvatar] = useState(avatarUrl);

  return (
    <form action={action} className="space-y-4">
      <Panel title="how we reach you">
        <div className="space-y-4">
          <AvatarPicker
            userId={userId}
            name={initial?.name ?? ""}
            value={avatar}
            onChange={setAvatar}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="full name"
              name="name"
              defaultValue={initial?.name ?? ""}
              placeholder="sam rivera"
              hint="first and last. payouts are made out to this name."
              required
            />
            <Field
              label="phone"
              name="phone"
              defaultValue={initial?.phone ?? ""}
              placeholder="+63 912 345 6789"
              hint="whatsapp works best. we use this and nothing else."
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="email"
              name="email"
              defaultValue={initial?.email ?? defaultEmail ?? ""}
              placeholder="you@email.com"
            />
            <Field
              label="discord"
              name="discord"
              defaultValue={initial?.discord ?? ""}
              placeholder="samrivera"
            />
            <Field
              label="where you are"
              name="location"
              defaultValue={initial?.location ?? ""}
              placeholder="manila, gmt+8"
              hint="city and timezone."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="country"
              name="country"
              defaultValue={initial?.country ?? ""}
              placeholder="philippines"
            />
            <Field
              label="time zone"
              name="timezone"
              defaultValue={initial?.timezone ?? ""}
              placeholder="gmt+8"
            />
            <Field
              label="languages"
              name="languages"
              defaultValue={initial?.languages ?? ""}
              placeholder="english, tagalog"
            />
          </div>
        </div>
      </Panel>

      <Panel title="your work">
        <div className="space-y-4">
          <Field
            label="portfolio link"
            name="portfolio_url"
            type="url"
            defaultValue={initial?.portfolio_url ?? ""}
            placeholder="drive.google.com/... or youtube.com/@..."
            hint="already have one? paste it. no portfolio yet is fine too, you can build a free one here after you apply."
          />
          <Field
            label="software"
            name="software"
            defaultValue={initial?.software.join(", ") ?? ""}
            placeholder="capcut, premiere, davinci"
            hint="comma separated. after effects is not needed for this."
          />
          <Area
            label="experience"
            name="experience"
            rows={3}
            defaultValue={initial?.experience ?? ""}
            placeholder="how long you have been cutting short form, and who for"
          />
        </div>
      </Panel>

      <Panel title="your availability">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="videos a day"
              name="videos_per_day"
              type="number"
              defaultValue={num(initial?.videos_per_day)}
              placeholder="3"
              hint="what you can hold every day, not your record."
            />
            <Field
              label="hours a week"
              name="hours_per_week"
              type="number"
              defaultValue={num(initial?.hours_per_week)}
              placeholder="25"
            />
          </div>

          <div>
            <Label>weekends</Label>
            <div className="mt-1.5">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-pill border border-line bg-shell px-3.5 py-2 text-[14px] font-semibold has-checked:border-flame has-checked:bg-ember has-checked:text-flame-dark">
                <input
                  type="checkbox"
                  name="weekends"
                  defaultChecked={initial?.weekends ?? false}
                  className="accent-flame"
                />
                i can take weekend batches
              </label>
            </div>
          </div>

          <Area
            label="anything else"
            name="note"
            rows={3}
            defaultValue={initial?.note ?? ""}
            placeholder="optional"
          />
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <Submit pendingLabel={has ? "saving" : "submitting"}>
          {has ? "update my application" : "submit application"}
        </Submit>
        <Note state={state} />
        {!state.error && !state.ok && (
          <span className="text-[13px] text-ink-50">
            we read every one and we&apos;ll reach out.
          </span>
        )}
      </div>
    </form>
  );
}
