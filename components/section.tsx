import type { ReactNode } from "react";

/**
 * One vertical rhythm for the whole page. Every band uses this so the spacing
 * and the max width stay identical on mobile and desktop.
 */
export function Section({
  id,
  tone = "paper",
  className = "",
  children,
}: {
  id?: string;
  tone?: "paper" | "shell";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-20 px-5 py-12 sm:px-8 sm:py-16 ${
        tone === "shell" ? "bg-shell" : ""
      } ${className}`}
    >
      <div className="mx-auto w-full max-w-[1440px]">{children}</div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  highlight,
  sub,
  invert = false,
}: {
  eyebrow?: string;
  title: string;
  highlight?: string;
  sub?: string;
  invert?: boolean;
}) {
  return (
    /**
     * The measure belongs on the SUB, not up here.
     *
     * It used to be `max-w-[50ch]` on this wrapper, and `ch` resolves against
     * the element it is set on — this div, at body size — so the cap came out
     * around 400px. That is a good measure for a paragraph and far too narrow
     * for a 36px heading: it broke "Four things. That is all of it." and every
     * other short title on the page onto two lines.
     */
    <div className="mx-auto max-w-[760px] text-center">
      {eyebrow && (
        <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-flame">
          {eyebrow}
        </p>
      )}
      <h2
        className={`text-balance-tight text-[clamp(1.75rem,3.4vw,2.7rem)] font-extrabold leading-[1.1] tracking-[-0.035em] ${
          eyebrow ? "mt-3" : ""
        } ${invert ? "text-white" : ""}`}
      >
        {title}
        {highlight && <span className="text-flame"> {highlight}</span>}
      </h2>
      {sub && (
        <p
          className={`mx-auto mt-4 max-w-[50ch] text-[16.5px] leading-[1.65] sm:text-[17.5px] ${
            invert ? "text-white/60" : "text-ink-70"
          }`}
        >
          {sub}
        </p>
      )}
    </div>
  );
}
