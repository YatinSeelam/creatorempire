"use client";

import { useActionState, useEffect, useState } from "react";
import {
  submitEditorApplication,
  type EditorActionState,
} from "@/app/editors/actions";
import { Area, Field, Label, Note, Submit } from "@/components/dash/form";
import { AvatarPicker } from "@/components/editors/avatar-picker";
import { NiceSelect } from "@/components/editors/nice-select";
import { COUNTRIES, TIMEZONES, flagEmoji, localTimezone } from "@/lib/countries";

const empty: EditorActionState = {};

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({
  value: c.iso,
  label: `${flagEmoji(c.iso)}  ${c.name}`,
}));
const DIAL_OPTIONS = COUNTRIES.map((c) => ({
  value: c.iso,
  label: `${flagEmoji(c.iso)} ${c.dial}`,
}));
const TZ_OPTIONS = TIMEZONES.map((z) => ({ value: z, label: z }));

/**
 * The editor onboarding: one form, four screens, next next next, account.
 *
 * One <form> the whole way through: the steps are show/hide, not routes, so
 * every answer is still in the DOM when the last screen submits. The required
 * fields are controlled state because each step validates itself before
 * `next` moves on; the server re-checks everything anyway.
 *
 * Country and dial code are real dropdowns (flag + name, flag + code), and
 * picking a country snaps the dial code to match, which is the one place the
 * two fields talk. The phone that submits is the joined `dial number` in a
 * hidden input, so the action still reads a single `phone`.
 */
const STEPS = ["about you", "how we reach you", "your time", "how this works"];

export function OnboardingWizard({
  userId,
  defaultEmail,
}: {
  userId: string;
  defaultEmail?: string;
}) {
  const [state, action] = useActionState(submitEditorApplication, empty);
  const [step, setStep] = useState(0);
  const [nudge, setNudge] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [countryIso, setCountryIso] = useState("");
  const [tz, setTz] = useState("");
  const [languages, setLanguages] = useState("");
  const [email, setEmail] = useState(defaultEmail ?? "");
  // the dial code is a country pick of its own (several countries share +1),
  // snapped to the main country pick until touched directly.
  const [dialIso, setDialIso] = useState("US");
  const [phoneNum, setPhoneNum] = useState("");
  const [videos, setVideos] = useState("");
  const [hours, setHours] = useState("");
  const [software, setSoftware] = useState("");

  // default the time zone to the browser's own offset, after mount so the
  // server and client render the same empty select first.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- after mount so server and client render the same empty select first
    setTz((t) => t || localTimezone());
  }, []);

  const country = COUNTRIES.find((c) => c.iso === countryIso) ?? null;
  const dial = COUNTRIES.find((c) => c.iso === dialIso)?.dial ?? "+1";

  const pickCountry = (iso: string) => {
    setCountryIso(iso);
    setDialIso(iso);
  };

  const next = () => {
    if (step === 0) {
      if (!name.trim()) return setNudge("your name first.");
      // first and last, because this is the name a payout is made out to and
      // the name a creator sees on the job. "Elite" and "Octagon" are the two
      // that got through when the field just said name.
      if (!/\S\s+\S/.test(name.trim()))
        return setNudge("first and last name, not a handle.");
      if (!avatarUrl) return setNudge("add a photo of yourself.");
      if (!country) return setNudge("pick your country.");
      if (!tz) return setNudge("pick your time zone.");
      if (!languages.trim()) return setNudge("what languages do you speak?");
    }
    if (step === 1) {
      if (!email.trim() || !email.includes("@"))
        return setNudge("we need a real email.");
      if (!phoneNum.trim())
        return setNudge("we need a phone number. whatsapp is what we actually use.");
    }
    if (step === 2) {
      if (!videos.trim()) return setNudge("how many videos a day?");
      if (!hours.trim()) return setNudge("how many hours a week?");
      if (!software.trim()) return setNudge("what do you edit with?");
    }
    setNudge(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const back = () => {
    setNudge(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  const hide = (i: number) => (step === i ? "" : "hidden");

  return (
    <div className="mx-auto w-full max-w-[560px]">
      {/* progress: four bars and the step's name */}
      <div className="mb-5 flex items-center justify-between">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-flame">
          step {step + 1} of {STEPS.length} · {STEPS[step]}
        </p>
        <div className="flex gap-1.5">
          {STEPS.map((label, i) => (
            <span
              key={label}
              className={`h-1.5 w-6 rounded-pill ${i <= step ? "bg-flame" : "bg-line"}`}
            />
          ))}
        </div>
      </div>

      <form
        action={action}
        className="rounded-card border border-line bg-paper px-6 py-6 sm:px-7"
      >
        {/* what the action reads for the composite fields */}
        <input type="hidden" name="country" value={country?.name ?? ""} />
        <input type="hidden" name="timezone" value={tz} />
        <input type="hidden" name="phone" value={phoneNum.trim() ? `${dial} ${phoneNum.trim()}` : ""} />

        {/* ------------------------------------------------------ about you */}
        <div className={`space-y-4 ${hide(0)}`}>
          <div>
            <h2 className="text-[20px] font-extrabold tracking-[-0.02em]">
              who are you
            </h2>
            <p className="mt-1 text-[13.5px] text-ink-50">
              your name and photo are what a creator sees on every job you
              claim. everything else on this form stays with us.
            </p>
          </div>
          <Field
            label="full name"
            name="name"
            value={name}
            onChange={setName}
            placeholder="sam rivera"
            hint="first and last. payouts are made out to this name."
            required
          />
          <AvatarPicker
            userId={userId}
            name={name}
            value={avatarUrl}
            onChange={setAvatarUrl}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>country</Label>
              <NiceSelect
                value={countryIso}
                onChange={pickCountry}
                options={COUNTRY_OPTIONS}
                placeholder="pick your country"
                searchable
              />
            </div>
            <div>
              <Label>time zone</Label>
              <NiceSelect
                value={tz}
                onChange={setTz}
                options={TZ_OPTIONS}
                placeholder="pick your time zone"
              />
            </div>
          </div>
          <Field
            label="languages"
            name="languages"
            value={languages}
            onChange={setLanguages}
            placeholder="english, tagalog"
            hint="briefs and creator messages are in english."
            required
          />
        </div>

        {/* ------------------------------------------------- how we reach you */}
        <div className={`space-y-4 ${hide(1)}`}>
          <div>
            <h2 className="text-[20px] font-extrabold tracking-[-0.02em]">
              how we reach you
            </h2>
            <p className="mt-1 text-[13.5px] text-ink-50">
              day to day everything happens on the platform. these are for when
              something is urgent.
            </p>
          </div>
          <Field
            label="email"
            name="email"
            value={email}
            onChange={setEmail}
            placeholder="you@email.com"
            required
          />
          <div>
            <Label>phone</Label>
            <div className="flex items-start gap-2.5">
              <div className="w-[124px] shrink-0">
                <NiceSelect
                  value={dialIso}
                  onChange={setDialIso}
                  options={DIAL_OPTIONS}
                  placeholder={dial}
                  searchable
                  menuClass="w-[220px]"
                />
              </div>
              <div className="mt-1.5 flex min-w-0 flex-1 items-center rounded-xl border border-line bg-shell px-3.5 focus-within:border-flame">
                <input
                  type="text"
                  inputMode="tel"
                  value={phoneNum}
                  onChange={(e) => setPhoneNum(e.target.value)}
                  placeholder="912 345 6789"
                  required
                  className="w-full bg-transparent py-2.5 text-[14.5px] font-medium placeholder:font-normal placeholder:text-ink-50/70 focus:outline-none"
                />
              </div>
            </div>
            <p className="mt-1 text-[12.5px] text-ink-50">whatsapp works best.</p>
          </div>
          <Field label="discord" name="discord" placeholder="samrivera (optional)" />
        </div>

        {/* --------------------------------------------------------- your time */}
        <div className={`space-y-4 ${hide(2)}`}>
          <div>
            <h2 className="text-[20px] font-extrabold tracking-[-0.02em]">
              your time
            </h2>
            <p className="mt-1 text-[13.5px] text-ink-50">
              be honest, not impressive. we plan volume around these answers.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="videos a day"
              name="videos_per_day"
              type="number"
              value={videos}
              onChange={setVideos}
              placeholder="3"
              hint="what you can hold every day, not your record."
              required
            />
            <Field
              label="hours a week"
              name="hours_per_week"
              type="number"
              value={hours}
              onChange={setHours}
              placeholder="25"
              required
            />
          </div>
          <Field
            label="software"
            name="software"
            value={software}
            onChange={setSoftware}
            placeholder="capcut, premiere, davinci"
            hint="comma separated."
            required
          />
          <div>
            <Label>weekends</Label>
            <div className="mt-1.5">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-pill border border-line bg-shell px-3.5 py-2 text-[14px] font-semibold has-checked:border-flame has-checked:bg-ember has-checked:text-flame-dark">
                <input type="checkbox" name="weekends" className="accent-flame" />
                i can take weekend batches
              </label>
            </div>
          </div>
          <Area
            label="experience"
            name="experience"
            rows={2}
            placeholder="how long you have been cutting short form, and who for (optional)"
          />
        </div>

        {/* ---------------------------------------------------- how this works */}
        <div className={`space-y-4 ${hide(3)}`}>
          <div>
            <h2 className="text-[20px] font-extrabold tracking-[-0.02em]">
              how this works
            </h2>
            <p className="mt-1 text-[13.5px] text-ink-50">
              the whole system in six lines. this is everything you need to know.
            </p>
          </div>
          <ul className="space-y-2.5 text-[14px] leading-[1.55] text-ink-70">
            <li>
              <strong>jobs get posted here.</strong> creators upload footage and a
              brief, it lands on the board, you claim what you want. no schedule,
              no minimums.
            </li>
            <li>
              <strong>two prices, set by us.</strong> $1 for talking head and
              reaction cuts, $2 for everything else. nothing to negotiate.
            </li>
            <li>
              <strong>36 hours once you claim.</strong> miss it and the job goes
              back to the pool and it counts against you. fast editors unlock $2
              jobs and more claims at once.
            </li>
            <li>
              <strong>every job is already funded.</strong> the creator pays before
              the job is ever posted. you will never edit an unpaid job.
            </li>
            <li>
              <strong>cash out whenever.</strong> approved work lands in your
              balance as credits, 1 credit = $1. hit request payout and it goes
              to the address you set. no minimum, no payout day.
            </li>
            <li>
              <strong>everything stays on the platform.</strong> delivery, redos
              and creator messages all happen here. that is what protects your
              payment.
            </li>
          </ul>
          <p className="rounded-card border border-line bg-shell px-4 py-3 text-[13.5px] text-ink-50">
            we are onboarding creators right now. a lot of jobs land soon, and
            spots go in signup order.
          </p>
        </div>

        {/* --------------------------------------------------------- controls */}
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-5">
          {step > 0 ? (
            <button
              type="button"
              onClick={back}
              className="rounded-pill border border-line px-5 py-2.5 text-[14px] font-semibold text-ink-70 transition-colors hover:text-ink"
            >
              back
            </button>
          ) : (
            <span />
          )}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={next}
              className="rounded-pill bg-flame px-7 py-2.5 text-[14.5px] font-semibold text-on-accent transition-colors hover:bg-flame-dark"
            >
              next
            </button>
          ) : (
            <Submit pendingLabel="creating your account">
              create my editor account
            </Submit>
          )}
        </div>
        {(nudge || state.error) && (
          <p className="mt-3 text-right text-[13px] font-semibold text-flame-dark">
            {nudge ?? state.error}
          </p>
        )}
        <Note state={{ ok: state.ok }} />
      </form>
    </div>
  );
}
