"use client";

import { useActionState } from "react";
import {
  clearUserCap,
  setUserCap,
  type UsageActionState,
} from "@/app/(dash)/founder/usage/actions";
import { Field, Note, Select, Submit } from "@/components/dash/form";
import { Panel, Row } from "@/components/dash/ui";

/**
 * The per-person daily cap, the one setting the usage page still has. Pricing
 * moved into code (`lib/usage-pricing.ts`); this stayed because "slow one
 * person down" is an operational decision, not a price.
 *
 * Plain forms posting to server actions that re-check admin, so nothing here is
 * trusted to be the gate. The forms only decide what a person is asked to type.
 */

const empty: UsageActionState = {};

export type Person = { id: string; label: string };

export type Override = {
  userId: string;
  label: string;
  cap: number | null;
  note: string | null;
};

const fmt = (n: number) => n.toLocaleString("en-US");

export function CapControls({
  people,
  overrides,
}: {
  people: Person[];
  overrides: Override[];
}) {
  const [state, action] = useActionState(setUserCap, empty);

  const options = [
    { value: "", label: "Pick someone" },
    ...people.map((p) => ({ value: p.id, label: p.label })),
  ];

  return (
    <Panel title="Caps for one person" padded={false}>
      <div className="px-5 py-5 sm:px-6">
        {people.length === 0 ? (
          <p className="text-[13.5px] leading-[1.6] text-ink-50">
            No accounts to pick from yet. Once somebody signs up they show up
            here and you can give them their own cap.
          </p>
        ) : (
          <form action={action}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Select label="Person" name="user_id" options={options} />
              <Field
                label="Credits a day"
                name="daily_credit_cap"
                type="number"
                placeholder="200"
                hint="Blank means no cap at all for them."
              />
              <Field
                label="Why"
                name="note"
                placeholder="Beta tester, needs room"
              />
            </div>
            <div className="mt-5 flex items-center gap-4">
              <Submit pendingLabel="Saving">Save override</Submit>
              <Note state={state} />
            </div>
          </form>
        )}
      </div>

      {overrides.length > 0 && (
        <div className="border-t border-line">
          {overrides.map((o) => (
            <Row key={o.userId}>
              <div className="min-w-0">
                <p className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">
                  {o.label}
                </p>
                <p className="mt-0.5 truncate text-[13px] text-ink-50">
                  {o.cap == null
                    ? "No cap at all"
                    : `${fmt(o.cap)} credits a day`}
                  {o.note ? ` · ${o.note}` : ""}
                </p>
              </div>
              <ClearForm userId={o.userId} />
            </Row>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ClearForm({ userId }: { userId: string }) {
  const [state, action] = useActionState(clearUserCap, empty);

  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="user_id" value={userId} />
      <Note state={state} />
      <Submit tone="line" size="sm" pendingLabel="Removing">
        Remove
      </Submit>
    </form>
  );
}
