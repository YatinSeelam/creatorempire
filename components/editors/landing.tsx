import Link from "next/link";
import { landing } from "@/lib/hiring";

/**
 * The signed-out /editors page, cut to the bone on purpose: editors register,
 * we post jobs, they get paid. One headline, one line, one button, three
 * steps. Everything else they learn inside the wizard after they sign up.
 */
export function EditorsLanding() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-[640px] flex-col items-center justify-center py-10 text-center">
      <h1 className="text-balance text-[clamp(2.1rem,6vw,3.4rem)] font-extrabold leading-[1.05] tracking-[-0.035em]">
        {landing.headline.pre}{" "}
        <span className="text-flame">{landing.headline.accent}</span>
      </h1>
      <p className="mt-4 max-w-[40ch] text-[16px] leading-[1.6] text-ink-70">
        {landing.sub}
      </p>

      <Link
        href="/sign-up?next=/editors"
        className="mt-8 rounded-pill bg-flame px-9 py-3.5 text-[16px] font-semibold text-on-accent transition-colors hover:bg-flame-dark"
      >
        become an editor
      </Link>
      <p className="mt-3 text-[13px] text-ink-50">
        <Link href="/login?next=/editors" className="font-semibold text-flame">
          already have an account
        </Link>
      </p>

      <div className="mt-12 grid w-full gap-4 sm:grid-cols-3">
        {landing.steps.map((step, i) => (
          <div
            key={step.title}
            className="rounded-card border border-line bg-paper px-5 py-5 text-left"
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-ember text-[13px] font-bold text-flame">
              {i + 1}
            </span>
            <h2 className="mt-3 text-[15.5px] font-bold tracking-[-0.015em]">
              {step.title}
            </h2>
            <p className="mt-1 text-[13.5px] leading-[1.5] text-ink-50">{step.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
