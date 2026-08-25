"use client";

import { Fragment, useActionState, useRef, useState, type ReactNode } from "react";
import {
  addAccount,
  addRule,
  addVideo,
  createDeal,
  createPayout,
  editRule,
  setVideoStats,
  updateBrand,
  updateDeal,
  type DealState,
} from "@/app/(dash)/deals/actions";
import { BrandMark } from "@/components/dash/brand-mark";
import { BrandPicker, type PickerBrand } from "@/components/dash/brand-picker";
import { Area, CheckRow, Field, Label, Note, Select, Submit } from "@/components/dash/form";
import { PlatformGlyph } from "@/components/dash/platform-glyph";
import {
  CURATED_BRANDS,
  faviconLogo,
  findBrand,
  matchCuratedBrand,
  normalizeDomain,
  searchBrands,
} from "@/lib/brand-catalog";
import { uploadBrandLogo } from "@/lib/brand-logo-upload";
import {
  ACCOUNT_FIELDS,
  BRAND_FIELDS,
  DEAL_FIELDS,
  DEAL_STATUS,
  FLAT_FEE_KIND,
  PAY_CYCLE,
  PLATFORM_HANDLE_HINT,
  PLATFORM_OPTIONS,
  POSTING_PERIOD,
  RULE_FIELDS,
  VIEW_COUNTING,
  WINDOW_KIND,
} from "@/lib/deal-schema";
import { quoteRule, sortedTiers } from "@/lib/bonus";
import {
  PLATFORMS,
  PLATFORM_LABEL,
  type BonusRule,
  type Brand,
  type Deal,
  type Platform,
  type RuleKind,
  type TierMode,
  type ViewCounting,
  type WindowKind,
} from "@/lib/deals";
import { money, views as fmtViews } from "@/lib/money";

const empty: DealState = {};

const platformOptions = PLATFORM_OPTIONS;

/**
 * The fields shared by create and edit, so the two can never drift, and every
 * label on them comes off DEAL_FIELDS rather than out of this file. That is the
 * same registry the server validates against and the AI layer will build its
 * tool schema from, so a field cannot mean one thing here and another there.
 */
function DealFields({ deal }: { deal?: Deal }) {
  // only so the view floor beside it can say whether it does anything. The
  // select itself stays uncontrolled.
  const [feeKind, setFeeKind] = useState<Deal["flat_fee_kind"]>(deal?.flat_fee_kind ?? "one_time");

  return (
    <>
      {/* what a deal cannot be created without: what it is called and what it
          pays. eleven fields used to sit here at once, each with its own line
          of help under it, which is two screens of form for a step whose real
          question is "how much, and how often". the other seven have defaults
          that are right nearly every time and an edit page a click away, so
          they wait in the fold below rather than being asked up front. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={DEAL_FIELDS.name.label}
          name="name"
          defaultValue={deal?.name ?? ""}
          placeholder={DEAL_FIELDS.name.example}
          hint={DEAL_FIELDS.name.hint}
        />
        <Select
          label={DEAL_FIELDS.status.label}
          name="status"
          options={DEAL_STATUS}
          defaultValue={deal?.status ?? "active"}
        />
        <Field
          label={DEAL_FIELDS.flat_fee_cents.label}
          name="flat_fee"
          prefix="$"
          defaultValue={deal ? (deal.flat_fee_cents / 100).toString() : ""}
          placeholder="750"
          type="number"
        />
        <Select
          label={DEAL_FIELDS.flat_fee_kind.label}
          name="flat_fee_kind"
          options={FLAT_FEE_KIND}
          defaultValue={deal?.flat_fee_kind ?? "one_time"}
          onChange={(v) => setFeeKind(v as Deal["flat_fee_kind"])}
          hint={DEAL_FIELDS.flat_fee_kind.hint}
        />

        {/* how much work, sitting directly under how much pay, because the two
            together are the deal: "$300 a video, two a day" is the whole thing
            a creator is agreeing to and neither half means much alone.

            it pairs the same way the fee does, a number and the unit it repeats
            on, and it stores the unit rather than converting: a rate sheet says
            "4 a week", so the form says it back the same way. */}
        <Field
          label={DEAL_FIELDS.posting_quota.label}
          name="posting_quota"
          defaultValue={deal?.posting_quota ? String(deal.posting_quota) : ""}
          placeholder="no set number"
          type="number"
          hint={DEAL_FIELDS.posting_quota.hint}
        />
        <Select
          label={DEAL_FIELDS.posting_period.label}
          name="posting_period"
          options={POSTING_PERIOD}
          defaultValue={deal?.posting_period ?? "day"}
        />
      </div>

      {/* open on the edit page, shut on the create one: editing a deal is
          nearly always about one of these, and creating one nearly never is. */}
      <Fold
        title="Dates, pay cycle and terms"
        sub="Starts and ends, when it invoices, net days, the contract"
        open={!!deal}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={DEAL_FIELDS.started_on.label}
            name="started_on"
            type="date"
            defaultValue={deal?.started_on ?? ""}
          />
          <Field
            label={DEAL_FIELDS.ends_on.label}
            name="ends_on"
            type="date"
            defaultValue={deal?.ends_on ?? ""}
            hint={DEAL_FIELDS.ends_on.hint}
          />
          <Select
            label={DEAL_FIELDS.pay_cycle.label}
            name="pay_cycle"
            options={PAY_CYCLE}
            defaultValue={deal?.pay_cycle ?? "monthly"}
          />
          <Field
            label={DEAL_FIELDS.cycle_anchor_on.label}
            name="cycle_anchor_on"
            type="date"
            defaultValue={deal?.cycle_anchor_on ?? ""}
            hint={DEAL_FIELDS.cycle_anchor_on.hint}
          />
          <Field
            label={DEAL_FIELDS.net_days.label}
            name="net_days"
            suffix="days"
            defaultValue={deal?.net_days ?? 30}
            type="number"
            hint={DEAL_FIELDS.net_days.hint}
          />
          <Field
            label={DEAL_FIELDS.contract_url.label}
            name="contract_url"
            type="url"
            defaultValue={deal?.contract_url ?? ""}
            placeholder="https://"
          />
          {/* stays with the base pay rather than down among the bonus rules:
              it is a condition on the fee, not a bonus of its own.

              It only means anything on a per-video fee: a one-off or a retainer
              is owed for the deal or the month and there is no per-post fee for
              a view floor to withhold. It said nothing about that, so it read
              as a general "views needed before this deal pays" and got filled
              in on deals where it does nothing at all. */}
          <Field
            label={DEAL_FIELDS.min_views_for_base.label}
            name="min_views_for_base"
            defaultValue={deal?.min_views_for_base ? String(deal.min_views_for_base) : ""}
            placeholder={feeKind === "per_video" ? "no minimum" : "only for a per video fee"}
            type="number"
            hint={
              feeKind === "per_video"
                ? DEAL_FIELDS.min_views_for_base.hint
                : "Nothing to gate: this fee is owed for the deal, not per post."
            }
          />
        </div>

        <Area
          className="mt-4"
          label={DEAL_FIELDS.notes.label}
          name="notes"
          defaultValue={deal?.notes ?? ""}
          placeholder="Who the contact is, what the deliverables are, anything you will forget."
        />
      </Fold>
    </>
  );
}

/**
 * The fields a form has to carry but rarely has to ask.
 *
 * A native `<details>` rather than state, for one reason that matters: the
 * fields inside stay in the DOM whether it is open or shut, so they post their
 * values either way. Unmounting them would make a closed fold silently clear
 * every field it hides on the edit page.
 */
function Fold({
  title,
  sub,
  open,
  children,
}: {
  title: string;
  sub?: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={open} className="group mt-5 rounded-2xl border border-line bg-shell/60">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <svg
          viewBox="0 0 24 24"
          className="size-4 shrink-0 text-ink-50 transition-transform group-open:rotate-90"
          aria-hidden="true"
        >
          <path
            d="m9 5 7 7-7 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="shrink-0 text-[14px] font-bold tracking-[-0.015em]">{title}</span>
        {sub && <span className="truncate text-[12.5px] text-ink-50">{sub}</span>}
      </summary>
      <div className="border-t border-line px-4 py-4">{children}</div>
    </details>
  );
}

/**
 * The accounts, on the create form.
 *
 * A brand deal means new accounts almost every time, so asking for them here
 * saves the trip to the deal page that used to be the only way to add one. All
 * three are optional and blanks are skipped, because a deal that only posts to
 * TikTok is normal and a required field would have people typing junk into the
 * other two.
 *
 * Exactly three rows, one per platform tracked, so there is nothing to add or
 * remove and no client state to get wrong. More of the same platform is a real
 * case but a rare one, and the deal page handles it.
 */
function AccountFields() {
  // controlled purely so the three rows are one piece of state rather than
  // three uncontrolled inputs. blank stays blank and is skipped on save.
  const [handles, setHandles] = useState<Record<string, string>>({});

  return (
    <div>
      {/* the step head already says what this is, so the field label that used
          to sit here repeated the title back word for word and pushed the
          first input a third of the way down the card. what goes in its place
          is the thing nobody knew: pasting a link is tracking, and posting for
          you is a separate, later switch. */}
      <div className="space-y-2.5">
        {PLATFORMS.map((platform) => (
          <div
            key={platform}
            className="flex items-center rounded-xl border border-line bg-shell px-3.5 focus-within:border-flame"
          >
            <span className="flex w-[112px] shrink-0 items-center gap-2 text-[13px] font-semibold text-ink-70">
              <PlatformGlyph platform={platform} className="size-[15px] text-ink-50" />
              {PLATFORM_LABEL[platform]}
            </span>
            {/* no "@" glyph in front: half of these arrive as a pasted profile
                url, and a url sitting behind an @ reads as a mistake. */}
            <input
              name={`account_${platform}`}
              value={handles[platform] ?? ""}
              onChange={(e) => setHandles((h) => ({ ...h, [platform]: e.target.value }))}
              placeholder={`Profile link, or @${PLATFORM_HANDLE_HINT[platform]}`}
              aria-label={`${PLATFORM_LABEL[platform]} ${ACCOUNT_FIELDS.handle.label.toLowerCase()}`}
              className="w-full bg-transparent py-2.5 text-[14.5px] font-medium placeholder:font-normal placeholder:text-ink-50/70 focus:outline-none"
            />
          </div>
        ))}
      </div>

      {/* the two halves said out loud, because they are genuinely different
          things and only one of them can happen here. a link is tracking. an
          upload-post profile is one row per (creator, deal), so posting cannot
          be set up until the deal exists — which is what the tick is for: it
          is not a setting, it is where the form lands you afterwards. saying
          "do it later on the deal page" and leaving somebody to find that page
          is how a deal ends up tracked and never posting. */}
      <label className="mt-4 flex cursor-pointer gap-3 rounded-xl border border-line bg-shell/60 px-4 py-3.5 transition-colors has-checked:border-flame has-checked:bg-ember">
        <input
          type="checkbox"
          name="connect_after"
          value="1"
          className="mt-0.5 size-4 shrink-0 accent-flame"
        />
        <span className="min-w-0">
          <span className="block text-[13.5px] font-bold tracking-[-0.015em]">
            Also connect these for autoposting
          </span>
          <span className="mt-1 block text-[12.5px] leading-[1.55] text-ink-50">
            A link is enough to track views and earnings. Posting for you needs the account logged
            in, which cannot happen until the deal exists. Tick this and Create deal drops you
            straight on the connect screen instead of the deal.
          </span>
        </span>
      </label>
    </div>
  );
}

/**
 * Creating a deal is a walk, not a wall.
 *
 * Four steps: who the brand is, what the base pay is, how the bonus pays, and
 * where it posts. Every step stays mounted and is only hidden, so the form
 * submits as one piece and going back never loses a field. The server still
 * validates everything once, in `createDeal`.
 *
 * **The bonus is a step here rather than a trip to the edit page.** It used to
 * say "add those afterwards", which meant a new deal was created wrong: the
 * bonus IS the pay on most rate sheets, and a deal carrying only its flat fee
 * reports the wrong money from the moment it exists. Getting one on cost a
 * redirect, an Edit deal click, a fold and a reveal, so it mostly did not
 * happen. There was a Review step in this slot; it restated what had just been
 * typed on a form every field of which is editable a minute later, so it was a
 * click that bought nothing.
 */
const WIZARD_STEPS = [
  { label: "Brand", title: "Who is the deal with", sub: "Pick the brand, or type a new one and it gets created with the deal." },
  { label: "Base pay", title: "Base pay and terms", sub: "The flat fee and how it pays out. The performance side is the next step." },
  { label: "Bonus", title: "How the bonus pays", sub: "The view tiers, the CPM, whatever the rate sheet says. Skip it if there is none and add it later." },
  { label: "Accounts", title: "Accounts you post from", sub: "Paste the profile link for each one you post to. All optional, all editable later." },
] as const;

export function NewDealForm({ brands }: { brands: PickerBrand[] }) {
  const [state, action] = useActionState(createDeal, empty);
  const [step, setStep] = useState(0);
  const [warn, setWarn] = useState("");
  // off by default: a deal with no bonus is a real deal, and a form that
  // assumes one gets a half-typed rule saved on every deal that has none.
  // `createDeal` reads this same flag and skips the rule fields when it is off.
  const [bonusOn, setBonusOn] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const last = WIZARD_STEPS.length - 1;

  const next = () => {
    const data = new FormData(formRef.current ?? undefined);
    const read = (k: string) => (data.get(k) ?? "").toString().trim();

    if (step === 0 && !read("brand_id") && !read("brand_name")) {
      setWarn("pick a brand first, or type a new one and hit enter");
      return;
    }
    setWarn("");
    setStep((s) => Math.min(s + 1, last));
  };

  return (
    <form
      ref={formRef}
      action={action}
      className="lg:flex lg:min-h-0 lg:flex-col"
      onKeyDown={(e) => {
        // enter in a text input fires the form's implicit submission, which
        // would create the deal from step one. before the last step it means
        // "continue". the brand picker prevents its own enter first, and that
        // shows up here as defaultPrevented, so it is not double-handled.
        if (e.key !== "Enter" || e.defaultPrevented || step === last) return;
        if ((e.target as HTMLElement).tagName !== "INPUT") return;
        e.preventDefault();
        next();
      }}
    >
      {/* ------------------------------------------------ progress header
          each step is a numbered node with a rule between, so the row reads as
          a path being walked and every step is named while it is walked rather
          than only when it is current. the labels hang off the nodes
          absolutely, so a long one cannot shove the rules out of true.

          a node behind you is a button: the wizard keeps every step mounted,
          so stepping back is free and clicking the dot is faster than the Back
          button four times. ahead of you it is inert, because the checks that
          gate Continue live on the way forward. */}
      <div className="mx-auto flex w-full max-w-[520px] shrink-0 items-center pb-7">
        {WIZARD_STEPS.map((s, i) => {
          const done = i < step;
          const here = i === step;
          return (
            <Fragment key={s.label}>
              {i > 0 && (
                <span
                  className={`h-[2px] flex-1 rounded-full transition-colors ${
                    i <= step ? "bg-flame" : "bg-line"
                  }`}
                />
              )}
              <button
                type="button"
                disabled={!done}
                aria-current={here ? "step" : undefined}
                onClick={() => {
                  setWarn("");
                  setStep(i);
                }}
                className="relative flex shrink-0 items-center justify-center disabled:cursor-default"
              >
                <span
                  className={`flex size-9 items-center justify-center rounded-full border text-[13.5px] font-bold transition-colors ${
                    done || here
                      ? "border-flame bg-flame text-on-accent"
                      : "border-line bg-paper text-ink-50"
                  }`}
                >
                  {done ? (
                    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
                      <path
                        d="m5 12.5 4.5 4.5L19 7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={`absolute top-full mt-2 whitespace-nowrap text-[12.5px] transition-colors ${
                    here ? "font-bold text-flame" : "font-semibold text-ink-50"
                  }`}
                >
                  {s.label}
                </span>
              </button>
            </Fragment>
          );
        })}
      </div>

      {/* one column, and a measured one. the step head used to sit in a 280px
          rail beside the fields to use the width up; what that actually bought
          was a paragraph of explainer given the same weight as the question it
          explains. the head reads above its own fields now.

          the fields between the head and the footer are the only thing that
          scrolls. steps here are not the same height and never will be: one
          asks for a brand, one carries eleven fields and a fold that opens.
          letting the page take that difference means the progress row and
          Continue slide off the top and bottom of a step somebody is halfway
          through, so the card is the frame and the fields move inside it.

          the height is not written down. it used to be a `100vh` cap here, and
          a cap that does not know what is above or below it is a guess: it was
          short by about a step's worth of chrome, so the moment a step got tall
          enough to reach it the card grew past the window and you got a page
          scrollbar AND a field scrollbar. the card is bounded to the viewport
          instead (see /deals/new), everything but this div is `shrink-0`, and
          what is left over is what the fields get.

          the min stops a short viewport collapsing the fields to a slot, and it
          is 160 rather than anything larger because it is also a floor the card
          cannot shrink under: set too high on a 720px window, the footer gets
          clipped by the frame and Continue becomes unreachable, which is a
          worse failure than a cramped field list. */}
      <div className="mx-auto mt-9 w-full max-w-[680px] lg:flex lg:min-h-0 lg:flex-col">
        <div className="shrink-0">
          <h2 className="text-[27px] font-bold leading-tight tracking-[-0.025em]">
            {WIZARD_STEPS[step].title}
          </h2>
          <p className="mt-2 text-[14.5px] text-ink-50">{WIZARD_STEPS[step].sub}</p>
        </div>

        <div className="mt-6 min-h-[160px] min-w-0 overflow-y-auto px-0.5 pb-1">
          <div hidden={step !== 0}>
            <BrandPicker brands={brands} />
            {warn && step === 0 && (
              <p className="mt-2.5 text-[13px] font-semibold text-flame">{warn}</p>
            )}
          </div>

          <div hidden={step !== 1}>
            <DealFields />
          </div>

          <div hidden={step !== 2}>
            {/* `rule_on` is the flag createDeal gates on, so the step is one
                click for a deal that has no bonus.

                a yes/no worth two full cards is a yes/no given the same weight
                as the eight fields it reveals. it is one line and two pills
                now, which is also 110px of the step's height handed back to
                the rule itself. */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 rounded-2xl border border-line bg-shell/60 px-4 py-3">
              <span className="text-[14px] font-bold tracking-[-0.015em]">
                Does this deal pay a bonus?
              </span>
              <span className="flex gap-2">
                {[
                  { value: "0", label: "No, flat fee only", on: !bonusOn },
                  { value: "1", label: "Yes, set it up", on: bonusOn },
                ].map((o) => (
                  <label
                    key={o.value}
                    className={`cursor-pointer rounded-pill border px-4 py-1.5 text-[13.5px] font-semibold transition-colors ${
                      o.on
                        ? "border-flame bg-ember text-flame-dark"
                        : "border-line bg-paper text-ink-50 hover:text-ink"
                    }`}
                  >
                    <input
                      type="radio"
                      name="rule_on"
                      value={o.value}
                      checked={o.on}
                      onChange={() => setBonusOn(o.value === "1")}
                      className="sr-only"
                    />
                    {o.label}
                  </label>
                ))}
              </span>
            </div>

            {bonusOn && (
              <div className="mt-5">
                <RuleFields prefix="rule_" />
              </div>
            )}
          </div>

          <div hidden={step !== last}>
            <AccountFields />
          </div>
        </div>

        {/* --------------------------------------------------- footer
            outside the scroller on purpose: Continue is the one control that
            has to be in the same place on every step, whatever is above it.
            forward sits on the right edge and back on the left, so the two
            buttons are never a pair to read: the one you want is the one
            under the direction you are going. */}
        <div className="mt-6 flex shrink-0 flex-wrap items-center gap-4 border-t border-line pt-6">
          {step > 0 && (
            <button
              type="button"
              onClick={() => {
                setWarn("");
                setStep((s) => s - 1);
              }}
              className="rounded-pill border border-line px-5 py-2.5 text-[14px] font-semibold text-ink-70 transition-colors hover:text-ink"
            >
              Back
            </button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-4">
            <Note state={state} />
            {step < last ? (
              <button
                type="button"
                onClick={next}
                className="rounded-pill bg-flame px-7 py-2.5 text-[14px] font-bold text-on-accent transition-colors hover:bg-flame-dark"
              >
                Continue
              </button>
            ) : (
              <Submit pendingLabel="Creating">Create deal</Submit>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

export function EditDealForm({ deal }: { deal: Deal }) {
  const [state, action] = useActionState(updateDeal, empty);

  return (
    <form action={action}>
      <input type="hidden" name="deal_id" value={deal.id} />
      <DealFields deal={deal} />
      <div className="mt-6 flex items-center gap-4">
        <Submit pendingLabel="Saving">Save deal</Submit>
        <Note state={state} />
      </div>
    </form>
  );
}

/**
 * The handle box that lives on the platform's own row.
 *
 * It replaced a separate "Add an account by handle" fold at the bottom of the
 * Accounts panel, which had its own platform dropdown. Two things were wrong
 * with that: the row above already said which platform you meant, so the
 * dropdown was a question the page could answer itself, and the fold read as a
 * different feature from the Connect button four inches above it when they are
 * the two halves of one decision. Now the row is the decision: type a handle
 * here to read the numbers, press Connect to also post.
 *
 * One `useActionState` per row rather than one for the panel, so an error on
 * TikTok is drawn on the TikTok row instead of under a form that no longer says
 * which platform it was about.
 */
export function AccountHandleForm({
  dealId,
  platform,
}: {
  dealId: string;
  platform: Platform;
}) {
  const [state, action] = useActionState(addAccount, empty);

  return (
    <form action={action} className="flex min-w-0 flex-wrap items-center gap-2">
      <input type="hidden" name="deal_id" value={dealId} />
      {/* the row is the platform picker. */}
      <input type="hidden" name="platform" value={platform} />
      {/* no "@" glyph in front: half of these arrive as a pasted profile url,
          and a url sitting behind an @ reads as a mistake. */}
      <input
        name="handle"
        placeholder={PLATFORM_HANDLE_HINT[platform]}
        aria-label={`${PLATFORM_LABEL[platform]} ${ACCOUNT_FIELDS.handle.label.toLowerCase()}`}
        className="h-9 w-full min-w-0 rounded-pill border border-line bg-shell px-3.5 text-[13.5px] font-medium transition-colors placeholder:font-normal placeholder:text-ink-50/70 focus:border-flame focus:outline-none sm:w-[200px]"
      />
      <Submit tone="line" size="sm" pendingLabel="Adding">
        Track
      </Submit>
      {state.error && (
        <p className="w-full text-[12px] font-semibold text-flame-dark">{state.error}</p>
      )}
    </form>
  );
}

/**
 * The brand behind the deal: who they are, who you talk to, what mark they get.
 *
 * It lives on the deal page rather than on a brands screen of its own because a
 * creator arrives here to look at one deal, and a second place to navigate to
 * for four fields is a worse trade than four fields at the bottom of this page.
 * Editing it changes the brand everywhere, which is the point: one Candle.
 */
export function BrandForm({ brand, dealId }: { brand: Brand; dealId: string }) {
  const [state, action] = useActionState(updateBrand, empty);
  // exactly what is stored, so what this form shows and what the rest of the
  // app draws can never disagree. no name matching here: that happens once, on
  // write, and clearing the key has to actually clear the logo.
  const [logoKey, setLogoKey] = useState(brand.logo_key ?? "");
  const [logoUrl, setLogoUrl] = useState(brand.logo_url ?? "");
  // controlled, because the logo suggestion below reads the site as it is
  // typed. everything else on this form stays uncontrolled.
  const [website, setWebsite] = useState(brand.website ?? "");
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const logo = logoKey ? (findBrand(logoKey)?.logo ?? "") : logoUrl;
  const results = (query.trim() ? searchBrands(query) : CURATED_BRANDS).slice(0, 12);

  // Both suggestions are offered, never applied on their own. Filling either
  // in silently would mean a creator who cleared a logo or a url on purpose got
  // it back on the next save, which is the same trap `brandLogo()` avoids by
  // refusing to re-match on read.
  const curated = matchCuratedBrand(brand.name);
  const siteDomain = normalizeDomain(website) ?? curated?.domain ?? null;
  const canUseFavicon = !logoKey && !logoUrl && !!siteDomain;
  const suggestedSite = website.trim() ? null : (curated?.website ?? null);

  return (
    <form action={action}>
      <input type="hidden" name="brand_id" value={brand.id} />
      <input type="hidden" name="deal_id" value={dealId} />
      <input type="hidden" name="logo_key" value={logoKey} />
      <input type="hidden" name="logo_url" value={logoUrl} />

      <div className="flex flex-wrap items-center gap-3">
        <BrandMark name={brand.name} logo={logo} size="lg" />
        <button
          type="button"
          onClick={() => setPicking((open) => !open)}
          className="rounded-pill border border-line px-3.5 py-1.5 text-[13px] font-semibold text-ink-70 transition-colors hover:text-ink"
        >
          {picking ? "Done" : logo ? "Change logo" : "Pick a logo"}
        </button>
        {/* the answer to "my niche brand is not on the list": a png, jpg, webp
            or svg under 1MB, resized in the browser before it uploads. */}
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="rounded-pill border border-line px-3.5 py-1.5 text-[13px] font-semibold text-ink-70 transition-colors hover:text-ink disabled:opacity-60"
        >
          {uploading ? "Uploading" : "Upload your own"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          aria-label="Upload a logo"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setUploadError("");
            setUploading(true);
            try {
              const url = await uploadBrandLogo(file);
              setLogoUrl(url);
              // the upload is the creator saying "this one", so the catalogue
              // key clears: brandLogo() prefers the key, and leaving it would
              // keep drawing the old mark over the file they just sent.
              setLogoKey("");
              setPicking(false);
            } catch (err) {
              setUploadError(
                err instanceof Error ? err.message : "Upload failed. Try again."
              );
            } finally {
              setUploading(false);
            }
          }}
        />
        {(logoKey || logoUrl) && (
          <button
            type="button"
            onClick={() => {
              setLogoKey("");
              setLogoUrl("");
            }}
            className="text-[13px] font-semibold text-ink-50 transition-colors hover:text-flame"
          >
            Remove
          </button>
        )}
      </div>
      {uploadError && (
        <p className="mt-2 text-[12px] font-semibold text-flame-dark">{uploadError}</p>
      )}

      {(suggestedSite || canUseFavicon) && (
        <p className="mt-2 text-[12.5px] text-ink-50">
          {suggestedSite && (
            <>
              We have a site for {brand.name}:{" "}
              <button
                type="button"
                onClick={() => setWebsite(suggestedSite)}
                className="font-semibold text-ink-70 underline underline-offset-2 transition-colors hover:text-ink"
              >
                {suggestedSite.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "")}
              </button>
              {canUseFavicon ? ". " : "."}
            </>
          )}
          {canUseFavicon && siteDomain && (
            <>
              No logo yet.{" "}
              <button
                type="button"
                onClick={() => setLogoUrl(faviconLogo(siteDomain))}
                className="font-semibold text-ink-70 underline underline-offset-2 transition-colors hover:text-ink"
              >
                Use the site icon
              </button>
              .
            </>
          )}
        </p>
      )}

      {picking && (
        <div className="mt-3">
          <div className="flex items-center rounded-xl border border-line bg-shell px-3.5 focus-within:border-flame">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the logo list"
              aria-label="Search the logo list"
              className="w-full bg-transparent py-2.5 text-[14.5px] font-medium placeholder:font-normal placeholder:text-ink-50/70 focus:outline-none"
            />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {results.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => {
                  setLogoKey(b.key);
                  setPicking(false);
                  setQuery("");
                }}
                title={b.name}
                className={`flex flex-col items-center gap-1.5 rounded-card border px-2 py-3 transition-colors ${
                  b.key === logoKey ? "border-flame" : "border-line hover:border-flame"
                }`}
              >
                <BrandMark name={b.name} logo={b.logo} size="sm" />
                <span className="w-full truncate text-center text-[11.5px] font-semibold">
                  {b.name}
                </span>
              </button>
            ))}
          </div>
          {results.length === 0 && (
            <p className="mt-2 text-[12.5px] text-ink-50">
              Nothing by that name. The list is a shortcut, not the whole world, so leave it
              blank and the brand shows its initial.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label={BRAND_FIELDS.name.label} name="name" defaultValue={brand.name} required />
        <Field
          label={BRAND_FIELDS.website.label}
          name="website"
          type="url"
          value={website}
          onChange={setWebsite}
          placeholder="https://"
        />
        <Field
          label={BRAND_FIELDS.contact_name.label}
          name="contact_name"
          defaultValue={brand.contact_name ?? ""}
          placeholder={BRAND_FIELDS.contact_name.example}
          hint={BRAND_FIELDS.contact_name.hint}
        />
        <Field
          label={BRAND_FIELDS.contact_email.label}
          name="contact_email"
          defaultValue={brand.contact_email ?? ""}
          placeholder={BRAND_FIELDS.contact_email.example}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Submit pendingLabel="Saving">Save brand</Submit>
        <Note state={state} />
      </div>
    </form>
  );
}

/**
 * A row of options that posts as one radio group, drawn as a segmented control.
 *
 * Radios rather than a `<select>` because every one of these choices changes
 * what the deal pays, and a closed dropdown hides the option that was not
 * picked. They are also uncontrolled, so the whole thing works before hydration.
 */
function Segmented({
  label,
  name,
  options,
  defaultValue,
  hint,
  onChange,
}: {
  label: string;
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue: string;
  hint?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-center gap-2 rounded-pill border border-line bg-shell px-3.5 py-2 text-[13.5px] font-semibold has-checked:border-flame has-checked:bg-ember has-checked:text-flame-dark"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              defaultChecked={o.value === defaultValue}
              onChange={() => onChange?.(o.value)}
              className="accent-flame"
            />
            {o.label}
          </label>
        ))}
      </div>
      {hint && <p className="mt-1 text-[12.5px] text-ink-50">{hint}</p>}
    </div>
  );
}

/* --------------------------------------------------------- the bonus form */

/**
 * A big radio drawn as a card: a title, a plain sentence under it, and the whole
 * thing is the click target.
 *
 * The three bonus kinds used to be a `<select>` whose options read "View tiers
 * (X views pays $Y)". A closed dropdown showing one of those is the single worst
 * way to ask this question: it hides the two shapes you did not pick, and the
 * shapes are the entire decision. As cards all three are on screen with a
 * sentence each and picking one is one click, not two.
 */
function Choice({
  name,
  value,
  checked,
  title,
  body,
  onPick,
}: {
  name: string;
  value: string;
  checked: boolean;
  title: string;
  body: string;
  onPick: (value: string) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer flex-col gap-1 rounded-xl border px-4 py-3 transition-colors ${
        checked ? "border-flame bg-ember" : "border-line bg-shell hover:border-line-hover"
      }`}
    >
      <span className="flex items-center gap-2">
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          onChange={() => onPick(value)}
          className="accent-flame"
        />
        <span className={`text-[14px] font-bold ${checked ? "text-flame-dark" : ""}`}>{title}</span>
      </span>
      <span className="text-[12.5px] leading-[1.5] text-ink-50">{body}</span>
    </label>
  );
}

/** Digits in, "50,000" out, so a view count is readable while it is typed. */
function groupDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 12);
  return digits ? Number(digits).toLocaleString("en-US") : "";
}

type TierDraft = { key: string; views: string; amount: string };

let tierSeq = 0;
const blankTier = (): TierDraft => ({ key: `t${(tierSeq += 1)}`, views: "", amount: "" });

/**
 * The tier ladder, the shape a rate sheet is actually written in: a view count
 * on the left, what it pays on the right, one step per row.
 *
 * Controlled rather than uncontrolled now, for one reason: the preview above it
 * has to price the ladder as it is typed, and an uncontrolled input cannot be
 * read without a ref per row. It costs nothing else, and it is what lets an
 * existing rule open with its own steps in the boxes.
 *
 * The placeholders say "e.g." out loud. The old ones were a grey "50,000" and a
 * grey "150" in every row, which on a screenshot is indistinguishable from a
 * two tier ladder somebody had already filled in.
 */
function Ladder({
  rows,
  setRows,
  prefix = "",
}: {
  rows: TierDraft[];
  setRows: (next: TierDraft[]) => void;
  /** see {@link RuleFields} — a bonus written inside the create form has to
   *  namespace its inputs so `ends_on` does not collide with the deal's own. */
  prefix?: string;
}) {
  const patch = (key: string, part: Partial<TierDraft>) =>
    setRows(rows.map((r) => (r.key === key ? { ...r, ...part } : r)));

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <Label>Pay these view milestones</Label>
        <button
          type="button"
          onClick={() => setRows([...rows, blankTier()])}
          className="text-[13px] font-semibold text-flame transition-colors hover:text-flame-dark"
        >
          + Add a milestone
        </button>
      </div>

      <div className="mt-1.5 space-y-2">
        {rows.map((row, i) => (
          <div key={row.key} className="flex items-center gap-2">
            <span aria-hidden className="w-4 shrink-0 text-center text-[14px] text-ink-50">
              ≥
            </span>
            <div className="flex min-w-0 flex-1 items-center rounded-xl border border-line bg-shell px-3.5 focus-within:border-flame">
              <input
                name={`${prefix}tier_views`}
                value={row.views}
                onChange={(e) => patch(row.key, { views: groupDigits(e.target.value) })}
                placeholder="e.g. 10,000"
                aria-label={`Milestone ${i + 1} views`}
                inputMode="numeric"
                className="w-full bg-transparent py-2.5 text-[14.5px] font-medium tabular-nums placeholder:font-normal placeholder:text-ink-50/60 focus:outline-none"
              />
              <span className="pl-1 text-[13px] text-ink-50">views</span>
            </div>
            <span aria-hidden className="shrink-0 text-[14px] text-ink-50">
              pays
            </span>
            <div className="flex w-[128px] shrink-0 items-center rounded-xl border border-line bg-shell px-3.5 focus-within:border-flame">
              <span className="pr-1 text-[14.5px] text-ink-50">$</span>
              <input
                name={`${prefix}tier_amount`}
                value={row.amount}
                onChange={(e) =>
                  patch(row.key, { amount: e.target.value.replace(/[^\d.]/g, "").slice(0, 10) })
                }
                placeholder="e.g. 75"
                aria-label={`Milestone ${i + 1} pay`}
                inputMode="decimal"
                className="w-full bg-transparent py-2.5 text-[14.5px] font-medium tabular-nums placeholder:font-normal placeholder:text-ink-50/60 focus:outline-none"
              />
            </div>
            <button
              type="button"
              // the last row never leaves, so the ladder cannot be emptied into a
              // state with nothing to type into.
              onClick={() => setRows(rows.length > 1 ? rows.filter((r) => r.key !== row.key) : rows)}
              aria-label={`Remove milestone ${i + 1}`}
              className="shrink-0 px-1 text-[16px] text-ink-50 transition-colors hover:text-flame"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[12.5px] text-ink-50">
        Only the highest milestone a post reaches pays. A post at 60k on a 10k and 50k ladder
        earns the 50k amount, not both.
      </p>
    </div>
  );
}

/** The options nobody needs on a normal deal, out of the way until they do. */
function More({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group rounded-xl border border-line bg-shell/60 px-4 py-3">
      <summary className="cursor-pointer list-none text-[13.5px] font-semibold text-ink-50 transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">+ More options</span>
        <span className="hidden group-open:inline">− More options</span>
        <span className="ml-2 font-normal text-ink-50/80 group-open:hidden">
          platforms, crossposting, floors and caps
        </span>
      </summary>
      <div className="mt-4 space-y-5">{children}</div>
    </details>
  );
}

const PREVIEW_DEFAULT = "100,000";

/**
 * The bonus form, for both writing one and correcting one.
 *
 * The old version asked eight questions in a flat column with a dropdown at the
 * top, and every one of them looked equally important, so the shape of the deal
 * (what it pays) sat level with a crossposting setting most deals never touch.
 * The order here is the order somebody says it out loud: what it pays, what a
 * post would earn, whether it replaces the base fee, how long it runs. The rest
 * is behind {@link More}.
 *
 * The preview is the part that was missing entirely. Nothing on the old form
 * told you what a rule would pay until a video had been posted, scraped and
 * summed, so a mistyped tier (150 cents instead of $150) was invisible for a
 * fortnight. It prices the rule as it is typed, off {@link quoteRule}, which
 * applies the same floor, ladder and cap the database does. It deliberately does
 * NOT apply the window or the crossposting mode: which views count is a question
 * about daily snapshots and about the cut's other posts, so those are said in
 * words under the number rather than folded into it.
 */
export function RuleFields({
  dealId = "draft",
  rule,
  baseCents = 0,
  baseKind = "one_time",
  prefix = "",
}: {
  dealId?: string;
  /** the rule being corrected. absent means these fields write a new one. */
  rule?: BonusRule;
  baseCents?: number;
  baseKind?: Deal["flat_fee_kind"];
  /**
   * Namespace for every input name here.
   *
   * The bonus lives inside the create form as well as in its own, and that form
   * already posts a deal-level `ends_on`. One `<form>` cannot carry two fields
   * of the same name and mean different dates by them, so the create wizard
   * renders these as `rule_*` and `createDeal` strips the prefix back off before
   * handing them to the same parser `addRule` uses.
   */
  prefix?: string;
}) {
  const [kind, setKind] = useState<RuleKind>(rule?.kind ?? "milestone");
  const [windowKind, setWindowKind] = useState<WindowKind>(rule?.window_kind ?? "forever");
  const [tierMode, setTierMode] = useState<TierMode>(rule?.tier_mode ?? "add");
  const [viewCounting, setViewCounting] = useState<ViewCounting>(
    rule?.view_counting ?? "per_video"
  );
  const [rows, setRows] = useState<TierDraft[]>(() =>
    rule && rule.kind === "milestone" && rule.tiers.length > 0
      ? sortedTiers(rule.tiers).map((t) => ({
          key: `t${(tierSeq += 1)}`,
          views: t.views.toLocaleString("en-US"),
          amount: String(t.amount_cents / 100),
        }))
      : // two empty rungs, not three. most rate sheets have two, Add a
        // milestone is right there, and the third blank row was 68px of the
        // step spent on a row most people delete.
        [blankTier(), blankTier()]
  );
  const [rate, setRate] = useState(
    rule?.rate_cents_per_1k != null ? String(rule.rate_cents_per_1k / 100) : ""
  );
  const [flat, setFlat] = useState(
    rule?.kind === "per_video" && rule.amount_cents != null ? String(rule.amount_cents / 100) : ""
  );
  const [minViews, setMinViews] = useState(
    rule?.min_views ? rule.min_views.toLocaleString("en-US") : ""
  );
  const [cap, setCap] = useState(rule?.cap_cents != null ? String(rule.cap_cents / 100) : "");
  const [preview, setPreview] = useState(PREVIEW_DEFAULT);

  const base = baseKind === "per_video" && baseCents > 0 ? money(baseCents) : "";

  // the rule as it stands in the boxes right now, in the shape quoteRule reads.
  // Only the fields the quote uses are real; the rest are filler so the type is
  // satisfied without a second, looser type existing to drift from this one.
  const draft: BonusRule = {
    id: rule?.id ?? "draft",
    deal_id: dealId,
    label: null,
    kind,
    tier_mode: tierMode,
    view_counting: viewCounting,
    platforms: [],
    rate_cents_per_1k: Math.round((Number(rate.replace(/[^\d.]/g, "")) || 0) * 100),
    amount_cents: Math.round((Number(flat.replace(/[^\d.]/g, "")) || 0) * 100),
    tiers: rows
      .filter((r) => r.views.trim() && r.amount.trim())
      .map((r) => ({
        views: Number(r.views.replace(/\D/g, "")) || 0,
        amount_cents: Math.round((Number(r.amount.replace(/[^\d.]/g, "")) || 0) * 100),
      })),
    min_views: Number(minViews.replace(/\D/g, "")) || 0,
    cap_cents: cap.trim() ? Math.round((Number(cap.replace(/[^\d.]/g, "")) || 0) * 100) : null,
    window_kind: windowKind,
    starts_on: rule?.starts_on ?? null,
    ends_on: rule?.ends_on ?? null,
    window_days: rule?.window_days ?? null,
  };

  const previewViews = Number(preview.replace(/\D/g, "")) || 0;
  const quote = quoteRule(draft, previewViews);
  const priced =
    kind === "cpm"
      ? draft.rate_cents_per_1k! > 0
      : kind === "per_video"
        ? draft.amount_cents! > 0
        : draft.tiers.length > 0;

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------- what it pays on */}
      <div>
        <Label>What this bonus pays on</Label>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
          <Choice
            name={`${prefix}kind`}
            value="milestone"
            checked={kind === "milestone"}
            onPick={(v) => setKind(v as RuleKind)}
            title="View milestones"
            body="A ladder: 10k pays $75, 50k pays $150. The highest one reached pays."
          />
          <Choice
            name={`${prefix}kind`}
            value="cpm"
            checked={kind === "cpm"}
            onPick={(v) => setKind(v as RuleKind)}
            title="CPM"
            body="A rate per 1,000 views. Every thousand is worth the same."
          />
          <Choice
            name={`${prefix}kind`}
            value="per_video"
            checked={kind === "per_video"}
            onPick={(v) => setKind(v as RuleKind)}
            title="A flat amount per post"
            body="Same money for every post. Views change nothing."
          />
        </div>
      </div>

      {kind === "milestone" && <Ladder rows={rows} setRows={setRows} prefix={prefix} />}

      {kind === "cpm" && (
        <Field
          label="CPM rate"
          name={`${prefix}rate`}
          prefix="$"
          placeholder="1.00"
          value={rate}
          onChange={(v) => setRate(v.replace(/[^\d.]/g, ""))}
          hint="A $1 CPM means $1 for every 1,000 counted views."
        />
      )}

      {kind === "per_video" && (
        <Field
          label="Amount per post"
          name={`${prefix}amount`}
          prefix="$"
          placeholder="50"
          value={flat}
          onChange={(v) => setFlat(v.replace(/[^\d.]/g, ""))}
        />
      )}

      {/* ------------------------------------------------------- the preview */}
      <div className="rounded-xl border border-line bg-shell px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <span className="text-[13.5px] text-ink-50">A post with</span>
          <span className="flex w-[124px] items-center rounded-lg border border-line bg-paper px-2.5 focus-within:border-flame">
            <input
              value={preview}
              onChange={(e) => setPreview(groupDigits(e.target.value))}
              inputMode="numeric"
              aria-label="Preview view count"
              placeholder="100,000"
              className="w-full bg-transparent py-1.5 text-[13.5px] font-semibold tabular-nums focus:outline-none"
            />
          </span>
          <span className="text-[13.5px] text-ink-50">views earns</span>
          <span className="text-[19px] font-bold tabular-nums tracking-[-0.02em] text-flame-dark">
            {priced ? money(quote.cents) : "$0"}
          </span>
          <span className="text-[13.5px] text-ink-50">from this bonus</span>
        </div>

        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-ink-50">
          {!priced
            ? kind === "milestone"
              ? "Fill a milestone in above and this prices it as you type."
              : "Put a number in above and this prices it as you type."
            : quote.underMin
              ? `Under the ${fmtViews(draft.min_views)} view floor set in More options, so it pays nothing.`
              : quote.capped
                ? `Capped at ${money(draft.cap_cents ?? 0)}, so the rate would have paid more.`
                : quote.tier
                  ? `That is the ${fmtViews(quote.tier.views)} milestone.${
                      quote.next
                        ? ` ${fmtViews(quote.next.viewsAway)} more views reaches ${money(
                            quote.next.tier.amount_cents
                          )}.`
                        : " The top of the ladder."
                    }`
                  : quote.next
                    ? `Nothing yet. The first milestone is ${fmtViews(quote.next.tier.views)} views for ${money(
                        quote.next.tier.amount_cents
                      )}.`
                    : "Every counted view earns at this rate."}
          {tierMode === "replace" && priced && quote.cents > 0 && base
            ? ` The ${base} base fee is not owed on top.`
            : ""}
        </p>
      </div>

      {/* ------------------------- against the base fee, and for how long
          two questions, one row. both used to be a pair of full description
          cards, which is 200px of prose for what is in the end two toggles,
          and it is what pushed the window select and More options off the
          bottom of the step. the sentence each one needs is one line under
          the pills, written for the option actually picked. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Segmented
          label="Against the base fee"
          name={`${prefix}tier_mode`}
          options={[
            { value: "add", label: "On top" },
            { value: "replace", label: "Instead of it" },
          ]}
          defaultValue={tierMode}
          onChange={(v) => setTierMode(v as TierMode)}
          hint={
            tierMode === "add"
              ? base
                ? `A post that earns this keeps the ${base} base fee as well.`
                : "The bonus is added to whatever the base fee already owes."
              : base
                ? `A post that earns this is paid this and not the ${base}. The usual rate sheet shape.`
                : "A post that earns this is paid this and not the base fee. The usual rate sheet shape."
          }
        />

        <div>
          <Label>How long it counts for</Label>
          <div className="mt-1.5 flex items-center rounded-xl border border-line bg-shell px-3.5 focus-within:border-flame">
            <select
              name={`${prefix}window_kind`}
              value={windowKind}
              onChange={(e) => setWindowKind(e.target.value as WindowKind)}
              className="w-full cursor-pointer bg-transparent py-2.5 text-[14.5px] font-medium focus:outline-none"
            >
              {WINDOW_KIND.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-50">
            {windowKind === "forever"
              ? "Every post keeps earning for as long as the deal is open. This is the expensive one to track."
              : windowKind === "since_post"
                ? "Each post earns on the views it picks up in its own first N days."
                : "Only views that land between the two dates count."}
          </p>
        </div>

        {windowKind === "since_post" && (
          <Field
            label="Days after posting"
            name={`${prefix}window_days`}
            suffix="days"
            placeholder="30"
            type="number"
            defaultValue={rule?.window_days ? String(rule.window_days) : ""}
          />
        )}

        {windowKind === "absolute" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="From"
              name={`${prefix}starts_on`}
              type="date"
              defaultValue={rule?.starts_on ?? ""}
            />
            <Field
              label="To"
              name={`${prefix}ends_on`}
              type="date"
              defaultValue={rule?.ends_on ?? ""}
              hint="Empty means open ended."
            />
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- rest */}
      <More
        open={Boolean(
          rule &&
            (rule.platforms.length > 0 ||
              rule.view_counting !== "per_video" ||
              rule.min_views > 0 ||
              rule.cap_cents != null ||
              rule.label)
        )}
      >
        <Field
          label="Label"
          name={`${prefix}label`}
          placeholder="TikTok tiers"
          defaultValue={rule?.label ?? ""}
          hint="Optional, for your own eyes."
        />

        <CheckRow
          label="Platforms this applies to"
          name={`${prefix}platforms`}
          options={platformOptions}
          values={rule?.platforms ?? []}
          hint="Leave all unticked to apply to every platform. Tick one to give it its own rate."
        />

        <Segmented
          label={RULE_FIELDS.view_counting.label}
          name={`${prefix}view_counting`}
          options={VIEW_COUNTING}
          defaultValue={viewCounting}
          onChange={(v) => setViewCounting(v as ViewCounting)}
          hint={
            viewCounting === "per_video"
              ? "Every post earns on its own views, so the same cut on three platforms is three separate payments."
              : viewCounting === "highest"
                ? "One cut, one payment, off whichever platform did best. The other posts of that cut earn nothing."
                : "One cut, one payment, off the total views across every platform it went out on."
          }
        />

        {viewCounting !== "per_video" && (
          <p className="rounded-card border border-line bg-paper px-4 py-3 text-[12.5px] text-ink-50">
            Posts are tied into one cut by their content group tag. Tag the same edit
            &quot;hook-3&quot; on all three platforms and it counts as one. An untagged post is a
            cut of its own.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Minimum views"
            name={`${prefix}min_views`}
            placeholder="no minimum"
            value={minViews}
            onChange={(v) => setMinViews(groupDigits(v))}
            hint={
              viewCounting === "per_video"
                ? "A post under this earns nothing from this bonus."
                : "A cut under this earns nothing from this bonus."
            }
          />
          <Field
            label={viewCounting === "per_video" ? "Cap per post" : "Cap per cut"}
            name={`${prefix}cap`}
            prefix="$"
            placeholder="no cap"
            value={cap}
            onChange={(v) => setCap(v.replace(/[^\d.]/g, ""))}
            hint="The most one of them can earn from this bonus."
          />
        </div>
      </More>
    </div>
  );
}

/**
 * {@link RuleFields} on its own, posting to the deal it belongs to.
 *
 * This is the surface on /deals/[id]/edit. The create wizard renders the fields
 * directly instead, because a deal and its first bonus are one submit there.
 */
export function RuleForm({
  dealId,
  rule,
  baseCents = 0,
  baseKind = "one_time",
}: {
  dealId: string;
  rule?: BonusRule;
  baseCents?: number;
  baseKind?: Deal["flat_fee_kind"];
}) {
  const editing = Boolean(rule);
  const [state, action] = useActionState(editing ? editRule : addRule, empty);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="deal_id" value={dealId} />
      {rule && <input type="hidden" name="rule_id" value={rule.id} />}

      <RuleFields dealId={dealId} rule={rule} baseCents={baseCents} baseKind={baseKind} />

      <div className="flex items-center gap-4">
        <Submit pendingLabel={editing ? "Saving" : "Adding"}>
          {editing ? "Save bonus" : "Add bonus"}
        </Submit>
        <Note state={state} />
      </div>
    </form>
  );
}

export function AddVideoForm({
  dealId,
  platforms,
}: {
  dealId: string;
  platforms: Platform[];
}) {
  const [state, action] = useActionState(addVideo, empty);

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-[1fr_170px_150px_auto] sm:items-end">
      <input type="hidden" name="deal_id" value={dealId} />
      <Field
        label="Post link"
        name="url"
        placeholder="https://www.tiktok.com/@you/video/..."
        hint={
          platforms.length
            ? `Matched to the ${platforms.map((p) => PLATFORM_LABEL[p]).join(", ")} account on this deal.`
            : "Add an account to this deal first."
        }
      />
      <Field
        label="Content group"
        name="content_group"
        placeholder="hook-3"
        hint="Same tag on all three platforms ties one cut together."
      />
      <Field label="Posted on" name="posted_on" type="date" />
      <div className="pb-[2px]">
        <Submit pendingLabel="Adding">Track</Submit>
      </div>
      <div className="sm:col-span-4">
        <Note state={state} />
      </div>
    </form>
  );
}

export type StatsTarget = {
  id: string;
  label: string;
  views: number;
  likes: number;
  comments: number;
};

/**
 * Typing the numbers in. The escape hatch for a private or locked-out account.
 *
 * One form at the foot of the table, with the post picked from a list, rather
 * than a fold hanging under every row. A creator with forty tracked posts had
 * forty "Type the numbers in" lines stacked between them, which is forty rows of
 * chrome for a thing that gets used on one post a month. Picking the post is one
 * extra click and it buys back the whole table.
 *
 * The fields remount on the selection (`key`), because they are uncontrolled and
 * would otherwise keep showing the first post's numbers after switching.
 */
export function ManualStatsForm({
  dealId,
  videos,
}: {
  dealId: string;
  videos: StatsTarget[];
}) {
  const [state, action] = useActionState(setVideoStats, empty);
  const [videoId, setVideoId] = useState(videos[0]?.id ?? "");
  const picked = videos.find((v) => v.id === videoId) ?? videos[0];

  if (!picked) return null;

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="deal_id" value={dealId} />

      <div className="min-w-[220px] flex-1">
        <Label>Post</Label>
        <div className="mt-1.5 flex items-center rounded-xl border border-line bg-shell px-3.5 focus-within:border-flame">
          <select
            name="video_id"
            value={videoId}
            onChange={(e) => setVideoId(e.target.value)}
            className="w-full cursor-pointer bg-transparent py-2.5 text-[14.5px] font-medium focus:outline-none"
          >
            {videos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Field
        key={`views-${picked.id}`}
        label="Views"
        name="views"
        defaultValue={picked.views}
        type="number"
        className="w-[120px]"
      />
      <Field
        key={`likes-${picked.id}`}
        label="Likes"
        name="likes"
        defaultValue={picked.likes}
        type="number"
        className="w-[100px]"
      />
      <Field
        key={`comments-${picked.id}`}
        label="Comments"
        name="comments"
        defaultValue={picked.comments}
        type="number"
        className="w-[110px]"
      />
      <div className="pb-[2px]">
        <Submit size="sm" pendingLabel="Saving">
          Save
        </Submit>
      </div>
      <Note state={state} />
    </form>
  );
}

/**
 * Locks what is owed right now into a payout row. The amounts arrive filled in
 * from the live calculation and stay editable, because the number a brand
 * actually agreed to is the one that goes on the invoice.
 */
export function PayoutForm({
  dealId,
  flatCents,
  bonusCents,
  periodStart,
  periodEnd,
}: {
  dealId: string;
  flatCents: number;
  bonusCents: number;
  periodStart: string;
  periodEnd: string;
}) {
  const [state, action] = useActionState(createPayout, empty);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="deal_id" value={dealId} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Period from" name="period_start" type="date" defaultValue={periodStart} />
        <Field label="Period to" name="period_end" type="date" defaultValue={periodEnd} />
        <Field
          label="Flat"
          name="flat_cents_input"
          prefix="$"
          type="number"
          defaultValue={(flatCents / 100).toFixed(2)}
        />
        <Field
          label="Bonus"
          name="bonus_cents_input"
          prefix="$"
          type="number"
          defaultValue={(bonusCents / 100).toFixed(2)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-[160px_1fr_auto] sm:items-end">
        <Field
          label="Adjustment"
          name="adjust_input"
          prefix="$"
          type="number"
          placeholder="0"
          hint="A correction to an earlier period."
        />
        <Field label="Note" name="notes" placeholder="Invoice 014" />
        <div className="pb-[2px]">
          <Submit pendingLabel="Logging">Log payout</Submit>
        </div>
      </div>
      <Note state={state} />
    </form>
  );
}
