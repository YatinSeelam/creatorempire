"use client";

import { useActionState } from "react";
import { buyCreditsPack, type EditingState } from "@/app/(dash)/editing/actions";
import { Note, Submit } from "@/components/dash/form";
import { CREDIT_PACKS, creditsLabel } from "@/lib/credits";
import { money } from "@/lib/money";

const empty: EditingState = {};

/**
 * The four packs. Each card is its own form so the pending state sits on the
 * button that was actually clicked; the action builds a stripe checkout and
 * redirects the browser there.
 */
export function CreditsShop() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {CREDIT_PACKS.map((pack) => (
        <PackCard key={pack.id} id={pack.id} />
      ))}
    </div>
  );
}

function PackCard({ id }: { id: string }) {
  const pack = CREDIT_PACKS.find((p) => p.id === id)!;
  const [state, action] = useActionState(buyCreditsPack, empty);

  return (
    <form
      action={action}
      className="flex flex-col rounded-card border border-line bg-paper px-5 py-5"
    >
      <input type="hidden" name="pack" value={pack.id} />
      <p className="text-[13px] font-semibold text-ink-50">{pack.blurb}</p>
      <p className="mt-2 text-[26px] font-extrabold tabular-nums tracking-[-0.02em]">
        {creditsLabel(pack.credits)}
      </p>
      {/* flat rate everywhere: no per-credit math, no decimals on screen */}
      <p className="mt-0.5 text-[13.5px] text-ink-50">
        {money(pack.priceCents)} · $1 = 1 credit
      </p>
      <div className="mt-4">
        <Submit size="sm" pendingLabel="Opening checkout">
          Buy
        </Submit>
      </div>
      <Note state={state} />
    </form>
  );
}
